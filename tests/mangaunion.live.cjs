// Explicit check against real endpoints; no image service is started.
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { createDecipheriv } = require("node:crypto")
const { join } = require("node:path")
const vm = require("node:vm")
const test = require("node:test")

test("real API: search, all chapters, and embedded decrypted integer/fractional pages", { timeout: 180000 }, async () => {
    const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/MangaUnion/main.ts"), "utf8"))
    const calls = [], readers = new Map(), encryptedPages = new Map()
    const p = vm.runInNewContext(`${source}\nnew Provider()`, {
        fetch: async (url, opts) => {
            calls.push(url)
            const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(25000) })
            const body = new Uint8Array(await res.arrayBuffer())
            let data
            if (url.startsWith("https://api.mangaunion.com/api/")) {
                data = JSON.parse(Buffer.from(body).toString("utf8"))
                if (data.chapter?.pages) readers.set(url, data.chapter)
            } else encryptedPages.set(url, body)
            // Match Seanime's raw body and synchronous json() rather than browser fetch.
            return { ok: res.ok, status: res.status, body, json: () => data }
        },
    })
    const results = await p.search({ query: "One Piece" })
    const manga = results.find(result => result.id === "one-piece")
    assert.ok(manga)
    assert.equal(manga.year, 1997)
    const chapters = await p.findChapters(manga.id)
    const series = await (await fetch("https://api.mangaunion.com/api/v1/manga/one-piece", { headers: { "User-Agent": "Mozilla/5.0" } })).json()
    assert.equal(chapters.length, series.stats.chapters)
    assert.ok(chapters.some(chapter => chapter.chapter === "0"))
    for (let i = 0; i < chapters.length; i++) {
        assert.equal(chapters[i].index, i)
        if (i) assert.ok(Number(chapters[i - 1].chapter) <= Number(chapters[i].chapter))
    }
    let totalBytes = 0
    for (const id of ["one-piece|1", "senpai-ga-urusai-kouhai-no-hanashi|180.5", "berserk|0.01"]) {
        const pages = await p.findChapterPages(id)
        const [slug, number] = id.split("|")
        const chapter = readers.get(`https://api.mangaunion.com/api/v1/manga/${slug}/chapters/${number}`)
        assert.equal(pages.length, chapter.pageCount)
        const seanimePages = id === "berserk|0.01" && process.env.SEANIME_MANGAUNION_PAGES
            ? JSON.parse(readFileSync(process.env.SEANIME_MANGAUNION_PAGES, "utf8")) : null
        if (seanimePages) assert.equal(seanimePages.length, pages.length)
        for (const page of pages) {
            assert.equal(Object.keys(page.headers).length, 0)
            assert.match(page.url, /^data:image\/webp;base64,/)
            const bytes = Buffer.from(page.url.split(",")[1], "base64")
            const original = chapter.pages[page.index]
            const decipher = createDecipheriv("chacha20", Buffer.from(chapter.enc.key, "base64url"),
                Buffer.concat([Buffer.alloc(4), Buffer.from(original.n, "base64url")]))
            assert.deepEqual(bytes, Buffer.concat([decipher.update(encryptedPages.get(original.url)), decipher.final()]))
            if (seanimePages) assert.deepEqual(Buffer.from(seanimePages[page.index].url.split(",")[1], "base64"), bytes)
            assert.equal(bytes.toString("ascii", 0, 4), "RIFF")
            assert.equal(bytes.toString("ascii", 8, 12), "WEBP")
            totalBytes += bytes.length
        }
        console.log(`${id}: ${pages.length} imágenes incorporadas, verificadas contra OpenSSL`)
    }
    assert.ok(calls.every(url => url.startsWith("https://api.mangaunion.com/") || url.startsWith("https://cdn.budgethosting.online/")))
    console.log(JSON.stringify({ searchResults: results.length, chapters: chapters.length,
        chapterApiRequests: calls.filter(url => url.includes("order=asc")).length, decryptedBytes: totalBytes }))
})
