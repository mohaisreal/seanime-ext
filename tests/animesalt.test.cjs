const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/AnimeSalt/main.ts"), "utf8"))
const base = "https://animesalt.cx"
const movie = `${base}/movies/jujutsu-kaisen-0/`
const series = `${base}/series/jujutsu-kaisen/`
const player = "https://ravok.buzz/video/movie-hash"
const stream = "https://ravok.buzz/cdn/hls/movie/master.m3u8?md5=signature&expires=123"
const seasons = "Season 1 • 1-24 (24) Season 2 • 1-23 (23) Season 3 • 1-12 (12)"
const searchHtml = [movie, series].map((url, i) =>
    `<article><h2 class="entry-title">Jujutsu Kaisen${i ? "" : " 0"}</h2><a href="${url}"></a></article>`).join("")

function response(data, status = 200, url) {
    // Seanime exposes synchronous text/json; URL may not be provided.
    return { ok: status >= 200 && status < 300, status, url, text: () => data, json: () => data }
}

function provider(fetch) {
    // Exercise the fallback for runtimes without a browser URL constructor.
    return vm.runInNewContext(`${source}\nnew Provider()`, { fetch })
}

function episode(mode = "sub", url = movie) {
    return { id: `${mode}$${url}`, number: 1, url }
}

test("TV searches exclude the related movie returned first by AnimeSalt", async () => {
    const p = provider(async url => {
        assert.ok([`${base}/?s=Jujutsu%20Kaisen`, series].includes(url))
        return response(url === series ? seasons : searchHtml)
    })
    const results = await p.search({ query: "Jujutsu Kaisen", dub: false, media: { format: "TV", episodeCount: 24 } })
    assert.equal(results.length, 3)
    assert.ok(results.every(result => result.url === series && result.id.startsWith("sub:series/")))
    const episodes = await p.findEpisodes(results[0].id)
    assert.equal(episodes.length, 24)
    assert.equal(episodes[2].url, `${base}/episode/jujutsu-kaisen-1x3/`)
})

test("movie search retains movies and excludes the related series", async () => {
    const results = await provider(async () => response(searchHtml)).search({
        query: "Jujutsu Kaisen", dub: false, media: { format: "MOVIE", episodeCount: 1 },
    })
    assert.equal(results.length, 1)
    assert.equal(results[0].url, movie)
})

test("episode count excludes movies when media format is absent", async () => {
    const results = await provider(async url => response(url === series ? seasons : searchHtml)).search({
        query: "Jujutsu Kaisen", dub: false, media: { episodeCount: 24 },
    })
    assert.ok(results.length > 0)
    assert.ok(results.every(result => result.url === series))
})

test("movie episode URLs work without a response URL and normalize cached double slashes", async () => {
    const p = provider(async url => {
        assert.equal(url, movie)
        return response("<h1>Jujutsu Kaisen 0</h1>", 200, `${base}//movies/jujutsu-kaisen-0/`)
    })
    const episodes = await p.findEpisodes("sub:movies/jujutsu-kaisen-0::eps=1")
    assert.equal(episodes.length, 1)
    assert.equal(episodes[0].url, movie)
    assert.equal(episodes[0].id, `sub$${movie}`)
    const fallback = await provider(async () => response("<h1>Movie</h1>")).findEpisodes("dub:movies/jujutsu-kaisen-0")
    assert.equal(fallback[0].url, movie)
})

for (const mode of ["sub", "dub"]) {
    test(`current Ravok embed resolves HLS, request headers and ${mode} subtitles`, async () => {
        const calls = []
        const p = provider(async (url, options) => {
            calls.push(url)
            if (url === movie) return response(`<iframe src="${player}" data-src="${player}"></iframe>`)
            if (url === player) return response('var playerjsSubtitle = "[English]https://as-cdn28.top/p/subtitle.jpg";')
            assert.equal(url, "https://ravok.buzz/player/index.php?data=movie-hash&do=getVideo")
            assert.equal(options.method, "POST")
            assert.equal(options.headers.Origin, "https://ravok.buzz")
            assert.equal(options.headers.Referer, player)
            assert.equal(options.headers["X-Requested-With"], "XMLHttpRequest")
            assert.equal(options.body, `hash=movie-hash&r=${encodeURIComponent(movie)}`)
            return response({ hls: true, videoSource: stream, securedLink: stream })
        })
        const result = await p.findEpisodeServer(episode(mode, `${base}//movies/jujutsu-kaisen-0/`), "default")
        assert.equal(result.server, "default")
        assert.equal(result.headers.Origin, "https://ravok.buzz")
        assert.equal(result.headers.Referer, "https://ravok.buzz/")
        assert.equal(result.videoSources.length, 1)
        const video = result.videoSources[0]
        assert.equal(video.url, stream)
        assert.equal(video.type, "m3u8")
        assert.equal(video.label, mode === "sub" ? "Sub" : "Dub")
        assert.equal(video.subtitles.length, mode === "sub" ? 1 : 0)
        if (mode === "sub") {
            assert.equal(video.subtitles[0].language, "en")
            assert.equal(video.subtitles[0].url, "https://as-cdn28.top/p/subtitle.jpg.srt")
        }
        assert.equal(calls.filter(url => url.includes("getVideo")).length, 1)
    })
}

test("lazy protocol-relative embeds resolve even with a placeholder src after data-src", async () => {
    const p = provider(async url => {
        if (url === movie) return response('<iframe data-src="//ravok.buzz/video/movie-hash" src="about:blank"></iframe>')
        assert.equal(url, "https://ravok.buzz/player/index.php?data=movie-hash&do=getVideo")
        return response({ securedLink: stream })
    })
    assert.equal((await p.findEpisodeServer(episode("dub"), "default")).videoSources[0].url, stream)
})

test("legacy AS CDN embeds still resolve", async () => {
    const legacy = "https://as-cdn28.top/video/legacy-hash"
    const p = provider(async url => {
        if (url === movie) return response(`<iframe src="${legacy}"></iframe>`)
        assert.equal(url, "https://as-cdn28.top/player/index.php?data=legacy-hash&do=getVideo")
        return response({ videoSources: [{ file: stream, label: "1080p" }, { file: stream }] })
    })
    const result = await p.findEpisodeServer(episode("dub"), "default")
    assert.equal(result.videoSources.length, 1)
    assert.equal(result.videoSources[0].quality, "1080p")
})

test("MegaPlay matching sub/dub mode remains preferred over Ravok", async () => {
    const mega = "https://megaplay.buzz/stream/123/sub"
    const p = provider(async url => {
        if (url === movie) return response(`<iframe src="${player}"></iframe><iframe src="${mega}"></iframe>`)
        if (url === mega) return response('<div data-id="source-id"></div>')
        assert.equal(url, "https://megaplay.buzz/stream/getSources?id=source-id")
        return response({ sources: { file: stream }, tracks: [{ kind: "captions", label: "English", file: "https://subs.example/en.vtt" }] })
    })
    const result = await p.findEpisodeServer(episode(), "default")
    assert.equal(result.videoSources[0].subtitles[0].language, "en")
    assert.equal(result.headers.Origin, "https://megaplay.buzz")
})

test("a failed player does not prevent trying the next compatible player", async () => {
    const p = provider(async url => {
        if (url === movie) return response(`<iframe src="https://megaplay.buzz/stream/123/dub"></iframe><iframe src="${player}"></iframe>`)
        if (url.includes("megaplay")) throw new Error("network failure")
        return response({ videoSource: stream })
    })
    assert.equal((await p.findEpisodeServer(episode("dub"), "default")).videoSources[0].url, stream)
})

test("unsupported, empty and failed players report errors instead of a fake successful server", async () => {
    await assert.rejects(provider(async () => response('<iframe src="https://unsupported.example/embed"></iframe>'))
        .findEpisodeServer(episode(), "default"), /no video sources.*0 supported players/)
    await assert.rejects(provider(async url => response(url === movie ? `<iframe src="${player}"></iframe>` : {}))
        .findEpisodeServer(episode("dub"), "default"), /no video sources.*1 supported players/)
    await assert.rejects(provider(async () => response("denied", 403))
        .findEpisodeServer(episode(), "default"), /failed to load episode \(HTTP 403\)/)
})

test("explicit season and part selections retain local episode numbering", async () => {
    const p = provider(async () => response(seasons))
    const second = await p.findEpisodes("sub:series/jujutsu-kaisen::eps=23::season=2")
    assert.equal(second.length, 23)
    assert.equal(second[0].url, `${base}/episode/jujutsu-kaisen-2x1/`)
    const part = await p.findEpisodes("dub:series/jujutsu-kaisen::eps=12::season=1::part=2")
    assert.equal(part.length, 12)
    assert.equal(part[0].url, `${base}/episode/jujutsu-kaisen-1x13/`)
    assert.equal(part[0].number, 1)
    assert.ok(part[0].id.startsWith("dub$"))
})
