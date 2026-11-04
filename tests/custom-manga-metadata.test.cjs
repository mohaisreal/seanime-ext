const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { stripTypeScriptTypes } = require("node:module")
const { join } = require("node:path")
const test = require("node:test")
const vm = require("node:vm")

const source = stripTypeScriptTypes(readFileSync(join(__dirname, "../src/CustomMangaMetadata/main.ts"), "utf8"))
const clone = value => JSON.parse(JSON.stringify(value))

// Seanime evaluates shared factories, UI registrations and hooks in separate VMs.
// Serializing callbacks here catches accidental references to outer-scope globals.
function plugin(storage = new Map()) {
    const factories = new Map(), hooks = {}, stores = new Map()
    let ui
    const globals = {
        $storage: { get: key => storage.has(key) ? clone(storage.get(key)) : undefined, set: (key, value) => storage.set(key, clone(value)) },
        $shared: {
            define: (key, callback) => factories.set(key, callback.toString()),
            use: key => {
                if (!stores.has(key)) stores.set(key, vm.runInNewContext(`(${factories.get(key)})()`, globals))
                return stores.get(key)
            },
        },
        $app: new Proxy({}, { get: (_, name) => callback => { hooks[name] = callback.toString() } }),
        $ui: { register: callback => { ui = callback.toString() } },
    }
    vm.runInNewContext(`${source}\ninit()`, globals)
    return {
        storage,
        store: globals.$shared.use("manga-metadata-overrides"),
        hook(name, event) { return vm.runInNewContext(`(${hooks[name]})(event)`, { ...globals, event }) },
        registerUI(ctx) { return vm.runInNewContext(`(${ui})(ctx)`, { ...globals, ctx }) },
    }
}

test("validates real dates, integer counts, score ranges, enum values and image schemes", () => {
    const { store } = plugin()
    for (const bad of [
        { chapters: "-1" }, { volumes: "1.5" }, { chapters: "9007199254740992" },
        { meanScore: "101" }, { meanScore: "NaN" }, { format: "TV" }, { status: "unknown" },
        { startDate: "2025-02-29" }, { endDate: "2026-04-31" }, { startDate: "0000-01-01" },
        { startDate: "2026-05-01", endDate: "2026-04-30" }, { coverImage: "javascript:alert(1)" },
    ]) assert.throws(() => store.validate(bad), JSON.stringify(bad))
    assert.deepEqual(clone(store.validate({ chapters: " 0 ", meanScore: "100", startDate: "2024-02-29", titleRomaji: "  Test  ", format: "default", synonyms: " " })),
        { chapters: "0", meanScore: "100", startDate: "2024-02-29", titleRomaji: "Test" })
})

test("applies manga fields including zero, preserves preferred language and unrelated properties", () => {
    const { store } = plugin()
    const media = { id: 7, title: { romaji: "Romaji", english: "English", userPreferred: "English" }, chapters: 20, volumes: 2, meanScore: 80, coverImage: { color: "#abc" } }
    store.save(7, { titleRomaji: "Nuevo romaji", titleEnglish: "Nuevo inglés", chapters: "0", volumes: "0", meanScore: "0", coverImage: "https://example.com/cover.png", genres: "Romance, Drama", startDate: "2024-02-29" })
    store.apply(media)
    store.apply(media) // Cached objects may pass through more than one hook.
    assert.equal(media.title.userPreferred, "Nuevo inglés")
    assert.equal(media.chapters, 0)
    assert.equal(media.volumes, 0)
    assert.equal(media.meanScore, 0)
    assert.equal(media.coverImage.color, "#abc")
    assert.equal(media.coverImage.extraLarge, "https://example.com/cover.png")
    assert.deepEqual(clone(media.genres), ["Romance", "Drama"])
    assert.deepEqual(clone(media.startDate), { year: 2024, month: 2, day: 29 })
})

test("all collection and entry hooks run in isolation, continue the chain and affect only the selected manga", () => {
    const p = plugin()
    p.store.save(7, { chapters: "150" })
    for (const name of ["onGetMangaCollection", "onGetRawMangaCollection", "onGetCachedMangaCollection", "onGetCachedRawMangaCollection", "onMangaLibraryCollectionRequested", "onMangaEntryRequested"]) {
        const selected = { id: 7, chapters: 1 }, other = { id: 8, chapters: 2 }
        let next = 0
        p.hook(name, { mangaCollection: { MediaListCollection: { lists: [{ entries: [{ media: selected }, { media: other }, {}] }] } }, next: () => next++ })
        assert.equal(selected.chapters, 150, name)
        assert.equal(other.chapters, 2)
        assert.equal(next, 1)
    }
    for (const [name, event] of [
        ["onGetManga", { manga: { id: 7 } }],
        ["onMangaEntry", { entry: { media: { id: 7 } } }],
        ["onMangaLibraryCollection", { libraryCollection: { lists: [{ entries: [{ media: { id: 7 } }] }] } }],
    ]) {
        let next = 0
        p.hook(name, { ...event, next: () => next++ })
        assert.ok(JSON.stringify(event).includes('"chapters":150'))
        assert.equal(next, 1)
        p.hook(name, { next() {} })
    }
})

test("persists across runtime reloads and resets one manga without erasing other overrides", () => {
    const p = plugin()
    p.store.save(7, { chapters: "12" })
    p.store.save(8, { volumes: "3" })
    const restarted = plugin(p.storage)
    assert.equal(restarted.store.load()[7].chapters, "12")
    restarted.store.save(7, null)
    const fresh = { id: 7, chapters: 20 }
    restarted.store.apply(fresh)
    assert.equal(fresh.chapters, 20)
    assert.equal(restarted.store.load()[7], undefined)
    assert.equal(restarted.store.load()[8].volumes, "3")
})

test("registers the manga action and tray without depending on init's lexical scope", () => {
    const p = plugin()
    const actions = []
    let render, click, opened = false
    const values = []
    p.registerUI({
        newTray: () => ({ render: fn => { render = fn }, open: () => { opened = true }, text: value => value }),
        state: initial => { let value = initial; return { get: () => value, set: next => { value = next } } },
        fieldRef: initial => { const ref = { current: initial, setValue: value => { ref.current = value } }; values.push(ref); return ref },
        action: { newMangaPageButton: props => { actions.push(props); return { onClick: fn => { click = fn }, mount() {} } } },
    })
    assert.equal(actions[0].label, "Editar metadata")
    assert.match(render(), /Abre una ficha/)
    p.store.save(7, { chapters: "12" })
    click({ media: { id: 7 } })
    assert.equal(opened, true)
    assert.equal(values[p.store.fields.findIndex(field => field.key === "chapters")].current, "12")
})
