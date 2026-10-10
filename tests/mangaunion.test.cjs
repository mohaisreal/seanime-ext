const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/MangaUnion/main.ts"), "utf8"))
const api = "https://api.mangaunion.com/api/v1"
const response = (data, status = 200) => ({ ok: status === 200, status, json: () => data })
const provider = fetch => vm.runInNewContext(`${source}\nnew Provider()`, { fetch })

test("search encodes queries and preserves title aliases, year and cover", async () => {
    const p = provider(async (url, opts) => {
        assert.equal(url, `${api}/manga?q=One%20%26%20Piece&limit=25&page=1`)
        assert.equal(opts.headers.Origin, "https://mangaunion.com")
        return response({ data: [
            { slug: "one-piece", title: "One Piece", titleEng: "One Piece", titleRomaji: "ONE PIECE", year: 1997, coverImage: "https://image/cover.webp" },
            { slug: "one-piece", title: "Duplicate" },
        ] })
    })
    assert.deepEqual(JSON.parse(JSON.stringify(await p.search({ query: " One & Piece " }))), [
        { id: "one-piece", title: "One Piece", synonyms: ["ONE PIECE"], year: 1997, image: "https://image/cover.webp" },
    ])
    assert.equal((await p.search({ query: " " })).length, 0)
})

test("loads all chapter pages and sorts zero, fractions and gaps", async () => {
    const calls = []
    const p = provider(async url => {
        calls.push(url)
        const page = Number(url.match(/page=(\d+)/)[1])
        return response({ data: page === 1 ? [
            { number: 3, title: "Terzo" }, { number: 0, releaseDate: "2020-11-03T03:58:54.943Z" },
        ] : [{ number: 1.5 }, { number: "1.50" }, { number: 8 }], meta: { totalPages: 2 } })
    })
    const chapters = await p.findChapters("https://mangaunion.com/manga/series/")
    assert.equal(calls.length, 2)
    assert.ok(calls.every(url => url.includes("order=asc")))
    assert.deepEqual(Array.from(chapters, c => c.chapter), ["0", "1.5", "3", "8"])
    assert.deepEqual(Array.from(chapters, c => c.index), [0, 1, 2, 3])
    assert.equal(chapters[0].updatedAt, "2020-11-03")
    assert.equal(chapters[1].id, "series|1.5")
    assert.equal(chapters[2].title, "Capitolo 3 - Terzo")
})

test("errors and stalled pagination never return partial lists", async () => {
    await assert.rejects(provider(async () => response({}, 403)).search({ query: "test" }), /HTTP 403/)
    await assert.rejects(provider(async () => response({ data: [] })).findChapters("series"), /paginación/)
    await assert.rejects(provider(async () => response({ data: [{ number: 1 }], meta: { totalPages: 3 } })).findChapters("series"), /incompleta/)
})

test("decrypts fractional chapters to embedded images without any helper or Node globals", async () => {
    const key = randomBytes(32), nonce = randomBytes(12)
    const originals = [Buffer.from("RIFF0000WEBPfirst"), Buffer.from("RIFF0000WEBPsecond")]
    const encrypted = originals.map(bytes => {
        const cipher = createCipheriv("chacha20", key, Buffer.concat([Buffer.alloc(4), nonce]))
        return Buffer.concat([cipher.update(bytes), cipher.final()])
    })
    const calls = []
    const p = provider(async url => {
        calls.push(url)
        if (url.startsWith(api)) {
            assert.equal(url, `${api}/manga/series/chapters/180.5`)
            return response({ chapter: { pageCount: 2, enc: { alg: "chacha20", key: key.toString("base64url") },
                pages: originals.map((_, index) => ({ url: `https://cdn.budgethosting.online/${index}.bin`, n: nonce.toString("base64url") })) } })
        }
        const index = Number(url.match(/\/(\d+)\.bin$/)[1])
        // Seanime's binary body is a byte array; text() and json() are synchronous.
        return { ok: true, body: Array.from(encrypted[index]) }
    })
    const pages = await p.findChapterPages("series|180.5")
    assert.equal(calls.length, 3)
    for (let i = 0; i < pages.length; i++) {
        assert.equal(pages[i].index, i)
        assert.equal(Object.keys(pages[i].headers).length, 0)
        assert.equal(pages[i].url, `data:image/webp;base64,${originals[i].toString("base64")}`)
    }
})

test("ChaCha20 matches OpenSSL for nonzero keys/nonces and partial/multiple blocks", () => {
    const p = provider(async () => {})
    const key = randomBytes(32), nonce = randomBytes(12)
    for (const length of [0, 1, 63, 64, 65, 20000]) {
        const bytes = randomBytes(length)
        const decipher = createDecipheriv("chacha20", key, Buffer.concat([Buffer.alloc(4), nonce]))
        const expected = Buffer.concat([decipher.update(bytes), decipher.final()])
        assert.deepEqual(Buffer.from(p.chacha20(bytes, key, nonce)), expected)
    }
})

test("base64 handles URL-safe keys, padding, and chunk boundaries without atob/Buffer", () => {
    const p = provider(async () => {})
    for (const length of [0, 1, 2, 3, 31, 32, 33, 20000]) {
        const bytes = randomBytes(length)
        assert.equal(p.encodeBase64(bytes), bytes.toString("base64"))
        assert.deepEqual(Buffer.from(p.decodeBase64(bytes.toString("base64url"))), bytes)
        assert.deepEqual(Buffer.from(p.decodeBase64(bytes.toString("base64"))), bytes)
    }
    assert.throws(() => p.decodeBase64("a"), /base64/)
    assert.throws(() => p.chacha20(new Uint8Array(), new Uint8Array(1), new Uint8Array(12)), /clave/)
})

test("uses Seanime's native base64 encoder when available", () => {
    const p = vm.runInNewContext(`${source}\nnew Provider()`, {
        CryptoJS: { enc: { Base64: { stringify: bytes => Buffer.from(bytes).toString("base64") } } },
    })
    const bytes = randomBytes(20000)
    assert.equal(p.encodeBase64(bytes), bytes.toString("base64"))
})

test("native binary conversion and concurrent downloads preserve page order", async () => {
    const key = randomBytes(32), nonce = randomBytes(12)
    const originals = Array.from({ length: 17 }, (_, i) => Buffer.from(`RIFF0000WEBPpage${i}`))
    const encrypted = originals.map(bytes => {
        const cipher = createCipheriv("chacha20", key, Buffer.concat([Buffer.alloc(4), nonce]))
        return Buffer.concat([cipher.update(bytes), cipher.final()])
    })
    let active = 0, maximum = 0, conversions = 0
    const p = vm.runInNewContext(`${source}\nnew Provider()`, {
        Buffer: { from: body => { conversions++; return new Uint8Array(body) } },
        CryptoJS: { enc: { Base64: { stringify: bytes => Buffer.from(bytes).toString("base64") } } },
        fetch: async url => {
            if (url.startsWith(api)) return response({ chapter: {
                pageCount: originals.length, enc: { alg: "chacha20", key: key.toString("base64") },
                pages: originals.map((_, i) => ({ url: `https://cdn.budgethosting.online/${i}.bin`, n: nonce.toString("base64") })),
            } })
            const index = Number(url.match(/\/(\d+)\.bin$/)[1])
            maximum = Math.max(maximum, ++active)
            await new Promise(resolve => setTimeout(resolve, 10 - index % 8))
            active--
            return { ok: true, body: Array.from(encrypted[index]) }
        },
    })
    const pages = await p.findChapterPages("series|1")
    assert.equal(maximum, 8)
    assert.equal(conversions, 17)
    for (let i = 0; i < pages.length; i++) {
        assert.equal(pages[i].index, i)
        assert.deepEqual(Buffer.from(pages[i].url.split(",")[1], "base64"), originals[i])
    }
})

test("reports incomplete pages, missing binary support and invalid decrypted data", async () => {
    const chapter = { pageCount: 1, pages: [{ url: "https://cdn.budgethosting.online/1.bin", n: Buffer.alloc(12).toString("base64url") }],
        enc: { alg: "chacha20", key: Buffer.alloc(32).toString("base64url") } }
    await assert.rejects(provider(async () => response({ chapter: { ...chapter, pageCount: 2 } })).findChapterPages("series|1"), /incompleta/)
    await assert.rejects(provider(async url => url.startsWith(api) ? response({ chapter }) : { ok: true }).findChapterPages("series|1"), /response.body/)
    await assert.rejects(provider(async url => url.startsWith(api) ? response({ chapter }) : { ok: true, body: [1, 2, 3] }).findChapterPages("series|1"), /imagen válida/)
    await assert.rejects(provider(async () => {}).findChapterPages("https://other/"), /ID/)
})

test("plain pages retain API order and reader headers", async () => {
    const p = provider(async () => response({ chapter: {
        pageCount: 2, pages: [{ url: "https://cdn/2.webp" }, { url: "https://cdn/1.webp" }],
    } }))
    const pages = await p.findChapterPages("series|1")
    assert.equal(pages[0].url, "https://cdn/2.webp")
    assert.equal(pages[1].index, 1)
    assert.equal(pages[0].headers.Referer, "https://mangaunion.com/manga/series/1")
})
