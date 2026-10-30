// Runs the actual provider and image requests inside Seanime's Goja runtime.
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { join } = require("node:path")

const base = process.argv[2] || "http://127.0.0.1:43211"
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/)
const source = readFileSync(join(__dirname, "../src/CapibaraTraductor/main.ts"), "utf8")
const code = source + `
const originalFindPages = Provider.prototype.findChapterPages;
Provider.prototype.findChapterPages = async function(id) {
    const pages = await originalFindPages.call(this, id);
    if (pages.length < 2) throw new Error("Expected a complete chapter");
    for (const page of [pages[0], pages[pages.length - 1]]) {
        if (page.url.indexOf("/promo/") >= 0) throw new Error("Promotional replacement");
        const res = await fetch(page.url, { headers: page.headers });
        if (!res.ok) throw new Error("Image HTTP " + res.status);
        const bytes = res.body;
        if (!bytes || bytes.length < 12) throw new Error("Empty image");
        const signature = String.fromCharCode(...Array.prototype.slice.call(bytes, 0, 12));
        if (signature.slice(0, 4) !== "RIFF" || signature.slice(8, 12) !== "WEBP") throw new Error("Invalid WebP");
    }
    return pages;
};`

async function main() {
    const providers = await (await fetch(`${base}/api/v1/extensions/list/manga-provider`)).json()
    const installed = providers.data.find(p => p.id === "capibaratraductor")
    assert.ok(installed, "Install and reload CapibaraTraductor first")
    console.log(`Proveedor cargado: ${installed.name}`)
    for (const id of [
        "thcscanlations|shinja-zero-no-megami-sama-to-hajimeru-isekai-kouryaku-classmate-saijaku-no-mahou-tsukai|3",
        "dnt|mashle-magia-y-musculos|149", "dnt|yozakura-san-chi-no-daisakusen|105",
    ]) {
        const res = await fetch(`${base}/api/v1/extensions/playground/run`, {
            method: "POST", headers: { "Content-Type": "application/json", Origin: base },
            body: JSON.stringify({ params: { type: "manga-provider", language: "typescript", code,
                function: "findChapterPages", inputs: { mediaId: 30013, id } } }),
            signal: AbortSignal.timeout(45000),
        })
        const data = await res.json()
        assert.ok(res.ok, JSON.stringify(data))
        assert.equal(typeof data.data?.value, "string", JSON.stringify(data))
        assert.ok(!data.data.value.startsWith("ERROR:"), data.data.value)
        const pages = JSON.parse(data.data.value)
        assert.ok(Array.isArray(pages) && pages.length > 1)
        assert.equal(new Set(pages.map(p => p.url)).size, pages.length)
        assert.ok(pages.every(p => /^https:\/\//.test(p.url) && !p.url.includes("/promo/")))
        console.log(`PASS ${id}: ${pages.length} páginas; primera y última imagen verificadas con fetch nativo`)
    }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
