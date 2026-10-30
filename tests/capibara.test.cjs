const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/CapibaraTraductor/main.ts"), "utf8"))
// Captured 2026-10-30; expected URLs independently obtained from the site's reader.
const fixtures = require("./fixtures/capibara-pages.json")
const id = "thcscanlations|series|3.5"
const reader = "https://capibaratraductor.com/thcscanlations/manga/series/chapters/3.5"
const insertedAtOne = "VWIS7XdgsjSsNbBWYf7iFHgZ"

function provider(data) {
    // Seanime has synchronous text() and no browser/Node decoding globals.
    return vm.runInNewContext(`${source}\nnew Provider()`, { fetch: async (url, opts) => {
        assert.equal(url, "https://capibaratraductor.com/api/manga-custom/series/chapter/3.5/pages")
        assert.equal(opts.headers["x-organization"], "thcscanlations")
        assert.equal(opts.headers.Referer, reader)
        return { ok: true, text: () => JSON.stringify(data) }
    } })
}

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
