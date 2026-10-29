// Run against a local Seanime instance: node tests/animesalt.live.cjs
// The provider, requests and HLS probes execute in Seanime's native Goja runtime.
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { join } = require("node:path")

const base = process.argv[2] || "http://localhost:43211"
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/)
const source = readFileSync(join(__dirname, "../src/AnimeSalt/main.ts"), "utf8")

async function run(method, inputs, code = source) {
    const response = await fetch(`${base}/api/v1/extensions/playground/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({ params: { type: "onlinestream-provider", language: "typescript", code, function: method, inputs } }),
        signal: AbortSignal.timeout(90000),
    })
    const result = await response.json()
    assert.ok(response.ok, JSON.stringify(result))
    assert.equal(typeof result.data?.value, "string", JSON.stringify(result))
    assert.ok(!result.data.value.startsWith("ERROR:"), result.data.value)
    return JSON.parse(result.data.value)
}

const probeCode = source + `
const resolveVideo = Provider.prototype.findEpisodeServer;
Provider.prototype.findEpisodeServer = async function(episode, server) {
    try {
        const result = await resolveVideo.call(this, episode, server);
        const video = result.videoSources[0];
        if (!video) throw new Error("No video");
        const master = await fetch(video.url, { headers: result.headers });
        const text = await master.text();
        if (!master.ok || !text.startsWith("#EXTM3U")) throw new Error("Invalid HLS master: " + master.status);
        const absolute = (url, base) => /^https?:/.test(url) ? url : url.startsWith("/") ? base.match(/^https?:\\/\\/[^/]+/)[0] + url : base.substring(0, base.lastIndexOf("/") + 1) + url;
        const first = text => text.split(/\\r?\\n/).find(l => l.trim() && !l.startsWith("#")).trim();
        const variantUrl = absolute(first(text), video.url);
        const variant = await fetch(variantUrl, { headers: result.headers });
        const variantText = await variant.text();
        if (!variant.ok || !variantText.startsWith("#EXTM3U")) throw new Error("Invalid HLS variant: " + variant.status);
        const segment = await fetch(absolute(first(variantText), variantUrl), { headers: { ...result.headers, Range: "bytes=0-187" } });
        if (!segment.ok) throw new Error("Segment HTTP " + segment.status);
        if (video.subtitles.length) {
            const subtitle = await fetch(video.subtitles[0].url, { headers: result.headers });
            if (!subtitle.ok || !(await subtitle.text()).includes("-->")) throw new Error("Invalid subtitles: " + subtitle.status);
        }
        result.server += " (master, variant, segment and subtitles verified)";
        return result;
    } catch (error) { throw String(error); }
};`

async function main() {
    const match = await run("search", { mediaId: 154768, dub: false })
    assert.match(match.id, /::season=2(?:$|::)/)
    console.log("PASS Season 2 automatic search:", match.title)
    for (const season of [1, 2]) {
        const mediaId = season === 1 ? 132405 : 154768
        const episodes = await run("findEpisodes", { mediaId, id: `sub:series/my-dress-up-darling::eps=12::season=${season}` })
        assert.equal(episodes.length, 12)
        assert.ok(episodes[0].url.endsWith(`-${season}x1/`))
        const result = await run("findEpisodeServer", { mediaId, episode: JSON.stringify(episodes[0]), server: "Ravok" }, probeCode)
        assert.match(result.server, /segment and subtitles verified/)
        assert.equal(result.videoSources[0].quality, "Auto - Ravok")
        assert.match(result.videoSources[0].label, /Japanese.*English/)
        console.log(`PASS Season ${season}: 12 episodes; ${result.server}; ${result.videoSources[0].label}`)
    }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
