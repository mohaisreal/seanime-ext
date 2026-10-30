// Explicit network check: node --test tests/capibara.live.cjs
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

test("real API: pg/rv produces distinct original images from two scans", { timeout: 90000 }, async () => {
    const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/CapibaraTraductor/main.ts"), "utf8"))
    const p = vm.runInNewContext(`${source}\nnew Provider()`, {
        fetch: async (url, options) => {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) })
            const body = await res.text()
            return { ok: res.ok, status: res.status, text: () => body }
        },
    })
    const promo = Buffer.from(await (await fetch("https://r2.capibaratraductor.com/tenants/capibara/promo/libre/v3.webp")).arrayBuffer())
    for (const id of [
        "thcscanlations|shinja-zero-no-megami-sama-to-hajimeru-isekai-kouryaku-classmate-saijaku-no-mahou-tsukai|3",
        "dnt|mashle-magia-y-musculos|149", "dnt|yozakura-san-chi-no-daisakusen|105",
    ]) {
        const pages = await p.findChapterPages(id)
        assert.ok(pages.length > 1)
        assert.equal(new Set(pages.map(p => p.url)).size, pages.length)
        const images = await Promise.all([pages[0], pages[pages.length - 1]].map(async page => {
            assert.doesNotMatch(page.url, /\/promo\//)
            const res = await fetch(page.url, { headers: page.headers, signal: AbortSignal.timeout(20000) })
            assert.equal(res.status, 200)
            assert.match(res.headers.get("content-type"), /^image\//)
            const bytes = Buffer.from(await res.arrayBuffer())
            assert.equal(bytes.toString("ascii", 0, 4), "RIFF")
            assert.equal(bytes.toString("ascii", 8, 12), "WEBP")
            assert.notDeepEqual(bytes, promo)
            return bytes
        }))
        assert.notDeepEqual(images[0], images[1])
        console.log(`${id}: ${pages.length} URLs originales; primera y última imagen verificadas`)
    }
})
