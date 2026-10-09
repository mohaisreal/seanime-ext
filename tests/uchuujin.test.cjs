const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/UchuujinProjects/main.ts"), "utf8"))
const baseUrl = "https://uchuujinmangas.com"

function chapterItem(number, subtitle = "Historia") {
    return `<li data-num="${number}"><div class="chbox"><a href="${baseUrl}/serie-capitulo-${number.replace(".", "-")}/">
        <span class="chapternum">Capítulo ${number}<i> - ${subtitle}</i></span>
        </a></div></li>`
}

function provider(fetch) {
    return vm.runInNewContext(`${source}\nnew Provider()`, { fetch })
}

test("includes fractional chapters between whole chapters with distinct reading indices", async () => {
    const html = ["4", "3.2", "3.1", "3", "2.75", "2", "0"].map(n => chapterItem(n)).join("\n")
    const p = provider(async url => {
        assert.equal(url, `${baseUrl}/manga/serie/`)
        return { ok: true, text: () => html }
    })
    const chapters = await p.findChapters("/manga/serie/")
    assert.deepEqual(Array.from(chapters, c => c.chapter), ["0", "2", "2.75", "3", "3.1", "3.2", "4"])
    assert.deepEqual(Array.from(chapters, c => c.index), [0, 1, 2, 3, 4, 5, 6])
    const fractional = chapters.find(c => c.chapter === "3.1")
    assert.equal(fractional.title, "Capítulo 3.1 - Historia")
    assert.equal(fractional.id, "/serie-capitulo-3-1/")
    assert.equal(fractional.url, `${baseUrl}/serie-capitulo-3-1/`)
})

test("a series consisting only of fractional chapters retains their full labels", async () => {
    const html = ["3.2", "3.1", "1.25", "1.1"].map(n => chapterItem(n, `Capítulo ${n}`)).join("\n")
    const chapters = await provider(async () => ({ ok: true, text: () => html })).findChapters("/manga/serie/")
    assert.deepEqual(Array.from(chapters, c => c.chapter), ["1.1", "1.25", "3.1", "3.2"])
    assert.deepEqual(Array.from(chapters, c => c.title), ["Capítulo 1.1", "Capítulo 1.25", "Capítulo 3.1", "Capítulo 3.2"])
})

test("a fractional chapter ID opens its own pages", async () => {
    const p = provider(async url => {
        if (url === `${baseUrl}/manga/serie/`) {
            return { ok: true, text: () => chapterItem("3.2") + chapterItem("3.1") }
        }
        assert.equal(url, `${baseUrl}/serie-capitulo-3-1/`)
        return { ok: true, text: () => 'var reader = {"sources": [{"source": "default", "images": ["https://images.example/3-1-page-1.jpg"]}]};' }
    })
    const chapters = await p.findChapters("/manga/serie/")
    const chapter = chapters.find(c => c.chapter === "3.1")
    assert.ok(chapter, "chapter 3.1 must be available")
    const pages = await p.findChapterPages(chapter.id)
    assert.equal(pages.length, 1)
    assert.equal(pages[0].url, "https://images.example/3-1-page-1.jpg")
    assert.equal(pages[0].headers.Referer, chapter.url)
})
