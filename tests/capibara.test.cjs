const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/CapibaraTraductor/main.ts"), "utf8"))
// Captured 2026-10-30; expected URLs independently obtained from the site's reader.
const fixtures = require("./fixtures/capibara-pages.json")
const readerFixtures = require("./fixtures/capibara-reader-v4.json")
const id = "thcscanlations|series|3.5"
const reader = "https://capibaratraductor.com/thcscanlations/manga/series/chapters/3.5"
const insertedAtOne = "VWIS7XdgsjSsNbBWYf7iFHgZ"

function chapterIsland(chapters) {
    const props = { manga: [0, { chapters: [1, chapters.map(chapter => [0, {
        number: [0, chapter.number], title: [0, chapter.title ?? null],
    }])] }] }
    return `<astro-island props="${JSON.stringify(props).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></astro-island>`
}

function chapterProvider(items, htmlByScan) {
    return vm.runInNewContext(`${source}\nnew Provider()`, {
        console: { log() {} },
        fetch: async url => {
            if (url.startsWith("https://capibaratraductor.com/api/manga-custom?")) {
                return { ok: true, json: () => ({ status: true, data: { items } }) }
            }
            const scan = url.split("/")[3]
            assert.equal(url, `https://capibaratraductor.com/${scan}/manga/series`)
            const html = htmlByScan[scan]
            return { ok: html !== undefined, status: html === undefined ? 503 : 200, text: () => html }
        },
    })
}

test("preserves actual chapter names from Astro props and keeps reading order and IDs", async () => {
    const p = chapterProvider([{ manga: { slug: "series" }, organization: { slug: "scan", name: "Scan" },
        chapters: [{ number: 2.5, title: "Previous API title" }, { number: 3, title: " API fallback " }] }], {
        scan: chapterIsland([{ number: 3, title: " " }, { number: 2.5, title: '  El plan de "Mash" & sus amigos  ' },
            { number: 1, title: null }, { number: 0, title: "Prólogo" }]),
    })
    const chapters = await p.findChapters("series")
    assert.deepEqual(Array.from(chapters, c => c.title), ["Prólogo", "Capítulo 1", 'El plan de "Mash" & sus amigos', "API fallback"])
    assert.deepEqual(Array.from(chapters, c => c.chapter), ["0", "1", "2.5", "3"])
    assert.deepEqual(Array.from(chapters, c => c.index), [0, 1, 2, 3])
    assert.equal(chapters[2].id, "scan|series|2.5")
    assert.equal(chapters[2].url, "https://capibaratraductor.com/scan/manga/series/chapters/2.5")
})

test("keeps scan-specific titles and search API titles when manga HTML is unavailable", async () => {
    const items = [
        { manga: { slug: "series" }, organization: { slug: "alpha", name: "Alpha" }, chapters: [{ number: 20, title: "Nombre de Alpha" }] },
        { manga: { slug: "series" }, organization: { slug: "beta", name: "Beta" }, chapters: [{ number: 20, title: "Nombre de Beta" }, { number: 21, title: null }] },
    ]
    for (const htmlByScan of [{}, { alpha: "<html></html>", beta: "<html></html>" }]) {
        const chapters = await chapterProvider(items, htmlByScan).findChapters("series")
        assert.deepEqual(Array.from(chapters, c => [c.scanlator, c.title]), [
            ["Alpha", "Nombre de Alpha"], ["Beta", "Nombre de Beta"], ["Beta", "Capítulo 21"],
        ])
    }
})

function provider(data, readerHtml) {
    // Seanime has synchronous text() and no browser/Node decoding globals.
    return vm.runInNewContext(`${source}\nnew Provider()`, { fetch: async (url, opts) => {
        if (url === reader && readerHtml !== undefined) return { ok: true, text: () => readerHtml }
        assert.equal(url, "https://capibaratraductor.com/api/manga-custom/series/chapter/3.5/pages")
        assert.equal(opts.headers["x-organization"], "thcscanlations")
        assert.equal(opts.headers.Referer, reader)
        return { ok: true, text: () => JSON.stringify(data) }
    } })
}

for (const fixture of readerFixtures) {
    test(`decodes ph/ls and HTML keys before removing inserted pages: ${fixture.id}`, async () => {
        const pages = await provider(fixture.response, fixture.readerHtml).findChapterPages(id)
        assert.deepEqual(Array.from(pages, p => p.url), fixture.expected)
        assert.deepEqual(Array.from(pages, p => p.index), fixture.expected.map((_, i) => i))
        assert.ok(fixture.response.data.some((p, i) => p.imageUrl !== fixture.expected[i]), "fixture must contain decoy URLs")
    })
}

test("rejects missing, stale and malformed HTML keys without returning valid-looking decoys", async () => {
    const fixture = readerFixtures[0]
    for (const html of ["<html></html>", fixture.readerHtml.replace(/[0-9a-f]{24}/, "000000000000000000000000"),
        fixture.readerHtml.replace(/[0-9a-f]{24}/, "not-a-key")]) {
        await assert.rejects(provider(fixture.response, html).findChapterPages(id), /clave|comprobación/)
    }
})

test("ph packets are bound to their original positions and page IDs", async () => {
    const fixture = readerFixtures[0]
    for (const change of [
        data => { data.data[0].id++ },
        data => { [data.data[0], data.data[1]] = [data.data[1], data.data[0]] },
        data => { data.data[0].ph = data.data[0].ph.slice(0, -1) + "!" },
        data => { delete data.data[0].ph },
        data => { delete data.ls },
        data => { data.ls = "invalid" },
    ]) {
        const response = structuredClone(fixture.response)
        change(response)
        await assert.rejects(provider(response, fixture.readerHtml).findChapterPages(id), /Capibara:/)
    }
})

for (const fixture of fixtures) {
    test(`decodes actual pg/rv packets: ${fixture.name}`, async () => {
        const pages = await provider(fixture.response).findChapterPages(id)
        assert.deepEqual(Array.from(pages, p => p.url), fixture.expected)
        assert.deepEqual(Array.from(pages, p => p.index), [0, 1, 2])
        assert.ok(pages.every(p => p.headers.Referer === reader && p.headers.Origin === "https://capibaratraductor.com"))
    })
}

test("decodes using original positions before removing inserted pages", async () => {
    const fixture = fixtures[0]
    const pages = await provider({ ...fixture.response, lh: insertedAtOne }).findChapterPages(id)
    assert.deepEqual(Array.from(pages, p => p.url), [fixture.expected[0], fixture.expected[2]])
    assert.deepEqual(Array.from(pages, p => p.index), [0, 1])
})

test("supports encoded imageUrl responses", async () => {
    const fixture = fixtures[1]
    const data = fixture.response.data.map(p => ({ imageUrl: p.pg }))
    const pages = await provider({ rv: fixture.response.rv, data }).findChapterPages(id)
    assert.deepEqual(Array.from(pages, p => p.url), fixture.expected)
})

test("continues to accept plain URLs and all previous response envelopes", async () => {
    const data = [{ url: "https://images.example/1.webp", index: 4 }, { image: "https://images.example/2.webp" }]
    for (const body of [data, { data }, { pages: data }, { data: { pages: data } }]) {
        const pages = await provider(body).findChapterPages(id)
        assert.deepEqual(Array.from(pages, p => p.url), data.map(p => p.url || p.image))
        assert.deepEqual(Array.from(pages, p => p.index), [0, 1])
    }
})

test("rejects missing/wrong keys, corrupt packets and unknown encoding versions", async () => {
    const fixture = fixtures[0].response
    const corrupt = structuredClone(fixture)
    const bytes = Buffer.from(corrupt.data[0].pg, "base64url")
    bytes[10] ^= 1
    corrupt.data[0].pg = bytes.toString("base64url")
    for (const data of [
        { ...fixture, rv: undefined }, { ...fixture, rv: "invalid" },
        { ...fixture, rv: fixtures[1].response.rv }, corrupt,
        { ...fixture, data: [{ pg: "AwAA" }] }, { ...fixture, data: [{ pg: "!invalid" }] },
    ]) await assert.rejects(provider(data).findChapterPages(id), /Capibara:/)
})

test("never returns promotional placeholders or partial page lists", async () => {
    await assert.rejects(provider({ data: [
        { imageUrl: "https://images.example/1.webp" }, fixtures[0].response.data[0],
    ] }).findChapterPages(id), /clave/)
    await assert.rejects(provider({ data: [{ imageUrl: fixtures[0].response.data[0].imageUrl }] }).findChapterPages(id), /original/)
    await assert.rejects(provider({ data: [{}] }).findChapterPages(id), /original/)
})

test("rejects damaged or out-of-range insertion metadata", async () => {
    const fixture = fixtures[0].response
    for (const lh of ["bad", "AAAAAAAAAAAAAAAAAAAAAAAA", insertedAtOne.slice(0, -1) + "A"]) {
        await assert.rejects(provider({ ...fixture, lh }).findChapterPages(id), /metadatos/)
    }
    await assert.rejects(provider({ data: [{ imageUrl: "https://images.example/1.webp" }], lh: insertedAtOne }).findChapterPages(id), /posición/)
})

test("handles API errors and empty responses", async () => {
    for (const data of [null, { status: false }, { status: false, data: fixtures[0].response.data }, { data: [] }]) {
        assert.equal((await provider(data).findChapterPages(id)).length, 0)
    }
})
