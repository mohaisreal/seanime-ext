/// <reference path="./manga-provider.d.ts" />

class Provider {

    private baseUrl = "https://capibaratraductor.com"
    private api = "https://capibaratraductor.com/api"

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: true,
        }
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const url = `${this.api}/manga-custom?page=1&limit=24&order=latest&nsfw=false&search=${encodeURIComponent(opts.query)}`
        const res = await fetch(url, {
            headers: { "Accept": "application/json" },
        })
        if (!res.ok) return []

        const json = await res.json() as CapibaraSearchResponse
        if (!json.status || !json.data?.items?.length) return []

        // Deduplicate by manga.slug — keep the entry with the most views per unique manga.
        // This way the user sees one result per manga, and findChapters merges all scans.
        const best: Record<string, CapibaraItem> = {}
        for (const item of json.data.items) {
            const existing = best[item.manga.slug]
            if (!existing || item.views > existing.views) {
                best[item.manga.slug] = item
            }
        }

        const results: SearchResult[] = []
        for (const slug of Object.keys(best)) {
            const item = best[slug]
            const year = item.releasedAt ? new Date(item.releasedAt).getFullYear() : 0
            const synonyms: string[] = item.manga.title !== item.title ? [item.manga.title] : []
            results.push({
                id: item.manga.slug,
                title: item.title,
                image: item.imageUrl ?? "",
                year: year || 0,
                synonyms,
            })
        }

        return results
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const parts = id.split("|")
        const mangaSlug = parts.length >= 2 ? parts[1] : parts[0]
        console.log("[capibara] findChapters mangaSlug=" + mangaSlug)

        const firstWord = mangaSlug.split("-")[0]
        const url = `${this.api}/manga-custom?page=1&limit=50&order=latest&nsfw=false&search=${encodeURIComponent(firstWord)}`
        const res = await fetch(url, { headers: { "Accept": "application/json" } })
        if (!res.ok) return []

        const json = await res.json() as CapibaraSearchResponse
        if (!json.status || !json.data?.items?.length) return []

        const matching = json.data.items.filter(i => i.manga.slug === mangaSlug)
        const items = matching.length > 0 ? matching : json.data.items

        const all: ChapterDetails[] = []

        for (const item of items) {
            const orgSlug = item.organization.slug
            const orgName = item.organization.name

            // Fetch full chapter list from Astro Island props in the manga page HTML.
            // Fall back to the search API's partial list (2 most recent) if HTML parsing fails.
            let chapters = await this._fetchChaptersFromHtml(orgSlug, mangaSlug)
            if (!chapters.length) {
                chapters = item.chapters
            }
            if (!chapters.length) continue

            console.log("[capibara] org=" + orgSlug + " chapters=" + chapters.length)

            for (const chapter of chapters) {
                const num = chapter.number
                const title = chapter.title?.trim() || item.chapters.find(c => c.number === num)?.title?.trim()
                all.push({
                    id: `${orgSlug}|${mangaSlug}|${num}`,
                    url: `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${num}`,
                    title: title || `Capítulo ${num}`,
                    chapter: String(num),
                    index: 0,
                    scanlator: orgName,
                })
            }
        }

        all.sort((a, b) => {
            const diff = parseFloat(a.chapter) - parseFloat(b.chapter)
            return diff !== 0 ? diff : (a.scanlator ?? "").localeCompare(b.scanlator ?? "")
        })

        for (let i = 0; i < all.length; i++) all[i].index = i
        console.log("[capibara] returning " + all.length + " chapters total")

        return all
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const [orgSlug, mangaSlug, chapterNum] = id.split("|")
        const readerUrl = `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${chapterNum}`

        const apiUrl = `${this.api}/manga-custom/${mangaSlug}/chapter/${chapterNum}/pages`
        const res = await fetch(apiUrl, {
            headers: {
                "Accept": "application/json",
                "x-organization": orgSlug,
                "Referer": readerUrl,
                "Origin": this.baseUrl,
            },
        })

        if (!res.ok) return []

        let json: any
        try { json = JSON.parse(await res.text()) } catch { return [] }
        if (!json || json.status === false) return []

        let raw: CapibaraPage[] = []
        if (Array.isArray(json)) {
            raw = json as CapibaraPage[]
        } else if (Array.isArray(json.data)) {
            raw = json.data as CapibaraPage[]
        } else if (Array.isArray(json.pages)) {
            raw = json.pages as CapibaraPage[]
        } else if (json.data && Array.isArray(json.data.pages)) {
            raw = json.data.pages as CapibaraPage[]
        }

        if (!raw.length) return []
        // Decode at the original API positions, then remove lh inserts. Current
        // imageUrl values can be valid URLs for unrelated images, not just promos.
        const readerKey = json.ls == null ? null : await this._readerKey(json.ls, readerUrl)
        const seed = readerKey !== null || json.rv == null ? null : this._pageSeed(json.rv)
        const pages = raw.map((p, index) => {
            let url = p.url ?? p.imageUrl ?? p.image ?? ""
            if (p.ph != null) {
                if (!readerKey) throw new Error("Capibara: falta la clave del lector.")
                url = this._decodeReaderUrl(p.ph, readerKey, index, p.id)
            } else if (readerKey) {
                // Never silently accept a decoy when an encoded page is missing.
                url = ""
            } else if (p.pg != null) {
                if (seed === null) throw new Error("Capibara: falta la clave de las páginas.")
                url = this._decodePageUrl(p.pg, seed, index)
            } else if (seed !== null && url && !/^https?:\/\//i.test(url)) {
                // Older reader responses place the encoded value in imageUrl itself.
                url = this._decodePageUrl(url, seed, index)
            }
            return url
        })
        const inserted = json.lh == null ? [] : this._insertedPages(json.lh, pages.length)
        return pages.filter((_, index) => inserted.indexOf(index) < 0).map((url, index) => {
            if (!/^https?:\/\//i.test(url) || /\/tenants\/capibara\/promo\//i.test(url)) {
                throw new Error("Capibara: no se pudo recuperar la imagen original de la página.")
            }
            return { url, index, headers: { Referer: readerUrl, Origin: this.baseUrl } }
        })
    }

    // Pure JS for Seanime/Goja: no browser globals, Node modules or remote scripts.
    private _decodeBase64(value: string): number[] {
        if (typeof value !== "string") throw new Error("Capibara: codificación de páginas inválida.")
        const input = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
        return this._decodeSymbols(input, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")
    }

    private _decodeSymbols(input: string, alphabet: string): number[] {
        if (typeof input !== "string" || input.length % 4 === 1) {
            throw new Error("Capibara: codificación de páginas inválida.")
        }
        const bytes: number[] = []
        let word = 0, bits = 0
        for (let i = 0; i < input.length; i++) {
            const digit = alphabet.indexOf(input[i])
            if (digit < 0) throw new Error("Capibara: codificación de páginas inválida.")
            word = (word << 6) | digit
            bits += 6
            if (bits >= 8) { bits -= 8; bytes.push((word >>> bits) & 255) }
        }
        return bytes
    }

    private _readerBytes(value: string): number[] {
        return this._decodeSymbols(value, "CDoIL78Qqwj9zKM6mOFdf0niV_AByGg4aNhbEetPsHr1x-TpZJYRk5lWu32vUcSX")
    }

    private _mix(value: number): number {
        value = Math.imul(value ^ (value >>> 16), 2146121005)
        value = Math.imul(value ^ (value >>> 15), 2221713035)
        return (value ^ (value >>> 16)) >>> 0
    }

    private _hash(value: string | number[]): number {
        let hash = 2166136261
        for (let i = 0; i < value.length; i++) {
            hash = Math.imul(hash ^ (typeof value === "string" ? value.charCodeAt(i) : value[i]), 16777619)
        }
        return hash >>> 0
    }

    private async _readerKey(value: string, readerUrl: string): Promise<CapibaraReaderKey> {
        const bytes = this._readerBytes(value)
        const header = bytes[0]
        if (bytes.length === 12) {
            const positions = [[3, 7, 1, 10], [5, 2, 9, 11], [8, 4, 11, 1], [2, 10, 6, 3],
                [9, 1, 5, 7], [11, 6, 3, 8], [4, 9, 2, 6], [7, 11, 8, 5]][header & 7]
            const masks = [93, 162, 25, 231]
            let seed = 0
            for (let i = 0; i < 4; i++) seed = (seed << 8) | (bytes[positions[i]] ^ masks[(i + header) & 3] ^ header)
            return { seed: seed >>> 0, version: 3 }
        }
        if (bytes.length !== 14) throw new Error("Capibara: formato de clave del lector no compatible.")
        const positions = [[12, 2, 13, 7, 1, 9, 8], [11, 4, 5, 6, 3, 9, 12], [9, 8, 2, 3, 1, 6, 13],
            [8, 7, 2, 13, 1, 3, 6], [13, 2, 11, 6, 4, 3, 8], [6, 1, 3, 4, 7, 5, 11],
            [4, 8, 7, 9, 1, 10, 13], [8, 3, 6, 13, 12, 10, 11]][header & 7]
        const masks = [234, 55, 192, 73, 249, 251, 2, 58]
        const parts = positions.map((position, i) => bytes[position] ^ masks[(i + header) & 7] ^ header)
        const period = (parts[0] << 16) | (parts[1] << 8) | parts[2]
        const maskedSeed = (parts[3] << 24) | (parts[4] << 16) | (parts[5] << 8) | parts[6]
        // The v4 key is split between the API and a short-lived literal in the
        // reader HTML. Parse only that literal; do not execute remote JS/Wasm.
        const res = await fetch(readerUrl, { headers: {
            Accept: "text/html,application/xhtml+xml", Referer: this.baseUrl, "Cache-Control": "no-cache",
        } })
        if (!res.ok) throw new Error(`Capibara: HTTP ${res.status} al obtener la clave del lector.`)
        const html = await res.text()
        for (let current = period - 1; current <= period + 1; current++) {
            const name = "_" + this._mix(current ^ 1000283751).toString(36)
            const literal = new RegExp(`\\b${name}\\s*=\\s*["']([0-9a-f]{24})["']`).exec(html)
            if (!literal) continue
            const slot = period - current + 1
            const fragment = parseInt(literal[1].slice(slot * 8, slot * 8 + 8), 16)
            const htmlSeed = fragment ^ this._mix((current * 3 + slot) ^ 739982445)
            return { seed: (maskedSeed ^ htmlSeed) >>> 0, version: 4 }
        }
        throw new Error("Capibara: no se encontró la clave vigente en el lector. Vuelve a abrir el capítulo.")
    }

    private _unwrapReaderPage(value: string, index: number): string {
        if (typeof value !== "string" || value.length < 2) throw new Error("Capibara: página codificada inválida.")
        const alphabet = "tgEib4lqMSha5TU13QX28deN-xuk6KywP0m_roGYvBWAnzFfjcJIVROp7CsDZ9HL"
        let shifted = ""
        for (let i = 0; i < value.length; i++) {
            const digit = alphabet.indexOf(value[i])
            if (digit < 0) throw new Error("Capibara: página codificada inválida.")
            shifted += alphabet[(digit - i * 7 - 13 - index) & 63]
        }
        const rotate = (value.length * 5 + index * 3 + 1) % value.length
        const rotated = shifted.slice(value.length - rotate) + shifted.slice(0, value.length - rotate)
        let result = ""
        for (let i = 0; i < value.length; i++) {
            result += i % 2 ? rotated[value.length - 1 - (i - 1) / 2] : rotated[i / 2]
        }
        return result
    }

    private _decodeReaderUrl(value: string, key: CapibaraReaderKey, index: number, id?: number | string): string {
        const bytes = this._readerBytes(this._unwrapReaderPage(value, index))
        if (bytes.length < 3 || bytes.length > 4096) throw new Error("Capibara: tamaño de página codificada inválido.")
        const v4 = key.version === 4
        let a = this._mix(key.seed ^ (v4 ? 1821285621 : 2704714413))
        let b = this._mix(a ^ Math.imul(index + 1, 2654435761))
        let c = this._mix(b ^ Math.imul(1, 2246822519) ^ this._hash(String(id ?? "")))
        let counter = this._mix(c ^ (v4 ? 374761393 : 668265263))
        const word = () => {
            const result = ((a + b) | 0) + counter | 0
            counter = (counter + 1) | 0
            a = b ^ (b >>> 9)
            b = (c + (c << 3)) | 0
            c = (c << 21) | (c >>> 11)
            c = (c + result) | 0
            return result >>> 0
        }
        for (let i = 0; i < (v4 ? 16 : 12); i++) word()
        let stream = 0
        for (let i = 0; i < bytes.length; i++) {
            if (i % 4 === 0) stream = word()
            bytes[i] ^= (stream >>> ((i % 4) * 8)) & 255
        }
        const payload = bytes.slice(3)
        if (bytes[0] !== key.version || (this._hash(payload) & 65535) !== ((bytes[1] << 8) | bytes[2])) {
            throw new Error("Capibara: la comprobación de la URL del lector ha fallado.")
        }
        return decodeURIComponent(payload.map(byte => "%" + ("0" + byte.toString(16)).slice(-2)).join(""))
    }

    private _random(seed: number): () => number {
        let state = seed >>> 0
        return () => {
            state = (state + 0x6d2b79f5) >>> 0
            let mixed = Math.imul(state ^ (state >>> 15), state | 1)
            mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
            return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000
        }
    }

    private _pageSeed(value: string): number {
        const bytes = this._decodeBase64(value)
        if (bytes.length !== 8) throw new Error("Capibara: clave de páginas inválida.")
        const mask = [60, 110, 243, 114]
        let seed = 0
        for (let i = 0; i < 4; i++) seed = (seed << 8) | (bytes[i * 2] ^ mask[i])
        return seed >>> 0
    }

    private _decodePageUrl(value: string, seed: number, index: number): string {
        const bytes = this._decodeBase64(value)
        if (bytes.length < 3 || bytes[0] !== 2) throw new Error("Capibara: formato de páginas no compatible.")
        // Field 0 is the full image; the website also uses field 1 for blurred previews.
        const random = this._random(seed ^ Math.imul(index + 1, 0x9e3779b1) ^ 0x7f4a7c15)
        let checksum = 90, escaped = ""
        for (let i = 2; i < bytes.length; i++) {
            const byte = bytes[i] ^ Math.floor(random() * 256)
            checksum = (checksum + byte * (i - 1)) & 255
            escaped += "%" + ("0" + byte.toString(16)).slice(-2)
        }
        if ((bytes[1] ^ Math.floor(random() * 256)) !== checksum) {
            throw new Error("Capibara: la comprobación de la URL de página ha fallado.")
        }
        return decodeURIComponent(escaped)
    }

    private _insertedPages(value: string, length: number): number[] {
        const bytes = this._decodeBase64(value)
        if (bytes.length !== 18) throw new Error("Capibara: metadatos de páginas inválidos.")
        const positions = [2, 7, 11, 16], rows: number[] = []
        let seed = 0
        for (let i = 0; i < bytes.length; i++) {
            if (positions.indexOf(i) >= 0) seed = (seed << 8) | bytes[i]
            else rows.push(bytes[i])
        }
        const order = rows.map((_, i) => i)
        const shuffle = this._random(seed ^ 1374496675)
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(shuffle() * (i + 1))
            const swap = order[i]; order[i] = order[j]; order[j] = swap
        }
        const random = this._random(seed ^ 795581489)
        const decoded = order.map(i => rows[i] ^ Math.floor(random() * 256))
        let checksum = 0
        for (let i = 0; i < decoded.length - 1; i++) checksum = (checksum + decoded[i] * (i + 1)) & 255
        const count = decoded[0]
        if ((checksum ^ 165) !== decoded[13] || count < 1 || count > 5) {
            throw new Error("Capibara: metadatos de páginas dañados.")
        }
        const inserted: number[] = []
        for (let i = 0; i < count; i++) {
            const index = (decoded[1 + i * 2] << 8) | decoded[2 + i * 2]
            if (index <= 0 || index >= length) throw new Error("Capibara: posición de página insertada inválida.")
            inserted.push(index)
        }
        return inserted
    }

    // ── Astro Island chapter extraction ───────────────────────────────────────

    private async _fetchChaptersFromHtml(orgSlug: string, mangaSlug: string): Promise<CapibaraChapter[]> {
        const url = `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}`
        const res = await fetch(url, {
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": this.baseUrl,
            },
        })
        if (!res.ok) {
            console.log("[capibara] manga page fetch failed status=" + res.status)
            return []
        }

        const html = await res.text()
        console.log("[capibara] manga page html length=" + html.length)

        const islandPattern = /<astro-island[^>]*\sprops="([^"]*)"[^>]*>/g
        let match: RegExpExecArray | null

        while ((match = islandPattern.exec(html)) !== null) {
            const decoded = match[1]
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&#x27;/g, "'")

            let props: any
            try { props = JSON.parse(decoded) } catch { continue }

            const deserialized = this._deserializeAstroValue(props)
            const chapters = this._findChaptersInObj(deserialized)

            if (chapters && chapters.length > 0) {
                console.log("[capibara] astro-island chapters=" + chapters.length)
                return chapters as CapibaraChapter[]
            }
        }

        console.log("[capibara] no chapters found in astro-island props")
        return []
    }

    // Recursively deserializes Astro's devalue prop format:
    //   [0, scalar_or_object] → unwrap scalar
    //   [1, [items]]          → unwrap array
    //   plain object          → recurse into values
    private _deserializeAstroValue(val: any): any {
        if (val === null || typeof val !== "object") return val
        if (!Array.isArray(val)) {
            const out: Record<string, any> = {}
            for (const key of Object.keys(val)) {
                out[key] = this._deserializeAstroValue(val[key])
            }
            return out
        }
        if (val.length === 2 && typeof val[0] === "number") {
            const [type, inner] = val as [number, any]
            if (type === 0) return this._deserializeAstroValue(inner)
            if (type === 1 && Array.isArray(inner)) {
                return inner.map((v: any) => this._deserializeAstroValue(v))
            }
        }
        return val.map((v: any) => this._deserializeAstroValue(v))
    }

    // Walks a deserialized object tree looking for an array whose items have a `number` field.
    private _findChaptersInObj(obj: any): any[] | null {
        if (!obj || typeof obj !== "object") return null
        if (Array.isArray(obj)) {
            if (obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null && "number" in obj[0]) {
                return obj
            }
            for (const item of obj) {
                const found = this._findChaptersInObj(item)
                if (found) return found
            }
            return null
        }
        if ("chapters" in obj) {
            const found = this._findChaptersInObj(obj.chapters)
            if (found) return found
        }
        for (const key of Object.keys(obj)) {
            const found = this._findChaptersInObj(obj[key])
            if (found) return found
        }
        return null
    }

}

// ── API types ─────────────────────────────────────────────────────────────────

interface CapibaraSearchResponse {
    status: boolean
    data: {
        items: CapibaraItem[]
        maxPage: number
        total: number
    }
}

interface CapibaraItem {
    id: number
    mangaId: number
    organizationId: number
    title: string
    imageUrl: string | null
    releasedAt: string | null
    status: string
    views: number
    manga: {
        id: number
        title: string
        slug: string
        releasedAt: string | null
    }
    organization: {
        id: number
        name: string
        slug: string
    }
    chapters: CapibaraChapter[]
}

interface CapibaraChapter {
    id: number
    number: number
    title: string | null
    releasedAt: string | null
    views: number
}

interface CapibaraPage {
    id?: number | string
    url?: string
    imageUrl?: string
    image?: string
    index?: number
    pg?: string
    ph?: string
}

interface CapibaraReaderKey {
    seed: number
    version: 3 | 4
}
