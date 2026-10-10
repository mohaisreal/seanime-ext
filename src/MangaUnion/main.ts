/// <reference path="./manga-provider.d.ts" />

class Provider {
    private baseUrl = "https://mangaunion.com"
    private api = "https://api.mangaunion.com/api/v1"

    getSettings(): Settings {
        return { supportsMultiLanguage: false, supportsMultiScanlator: false }
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const query = (opts.query || "").trim()
        if (!query) return []
        const data = await this.request<UnionList<UnionManga>>(
            `/manga?q=${encodeURIComponent(query)}&limit=25&page=1`, `${this.baseUrl}/manga`,
        )
        const seen = new Set<string>()
        return data.data.filter(item => {
            if (!item.slug || !item.title || seen.has(item.slug)) return false
            seen.add(item.slug)
            return true
        }).map(item => ({
            id: item.slug,
            title: item.title,
            synonyms: Array.from(new Set([item.titleEng, item.titleRomaji]
                .filter((title): title is string => !!title && title !== item.title))),
            image: item.coverImage || undefined,
            year: item.year || undefined,
        }))
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const slug = this.mangaSlug(id)
        const mangaUrl = `${this.baseUrl}/manga/${slug}`
        const chapters: ChapterDetails[] = []
        const seen = new Set<string>()
        for (let page = 1; ; page++) {
            if (page > 1000) throw new Error("MangaUnion: demasiadas páginas de capítulos.")
            const data = await this.request<UnionList<UnionChapter>>(
                `/manga/${encodeURIComponent(slug)}/chapters?limit=100&page=${page}&order=asc`, mangaUrl,
            )
            let added = 0
            for (const item of data.data) {
                const number = this.chapterNumber(item.number)
                const chapterId = `${slug}|${number}`
                if (seen.has(chapterId)) continue
                seen.add(chapterId)
                added++
                chapters.push({
                    id: chapterId,
                    url: `${mangaUrl}/${number}`,
                    title: `Capitolo ${number}${item.title ? ` - ${item.title}` : ""}`,
                    chapter: number,
                    index: 0,
                    language: "it",
                    updatedAt: item.releaseDate?.slice(0, 10),
                })
            }
            const totalPages = data.meta?.totalPages
            if (!Number.isInteger(totalPages) || totalPages! < 0) {
                throw new Error("MangaUnion: falta la paginación de capítulos.")
            }
            if (page >= totalPages!) break
            if (!added) throw new Error("MangaUnion: la paginación no avanza; lista incompleta.")
        }
        chapters.sort((a, b) => Number(a.chapter) - Number(b.chapter))
        return chapters.map((chapter, index) => ({ ...chapter, index }))
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const parts = id.split("|")
        if (parts.length !== 2) throw new Error("MangaUnion: ID de capítulo inválido.")
        const slug = this.mangaSlug(parts[0])
        const number = this.chapterNumber(parts[1])
        const readerUrl = `${this.baseUrl}/manga/${slug}/${number}`
        const data = await this.request<UnionReader>(
            `/manga/${encodeURIComponent(slug)}/chapters/${number}`, readerUrl,
        )
        const chapter = data.chapter
        if (!chapter || !Array.isArray(chapter.pages) || !chapter.pages.length) {
            throw new Error("MangaUnion: el capítulo no contiene páginas.")
        }
        if (chapter.pageCount !== chapter.pages.length) {
            throw new Error("MangaUnion: la lista de páginas está incompleta.")
        }

        if (chapter.enc) {
            if (chapter.enc.alg !== "chacha20" || !chapter.enc.key || chapter.pages.some(page => !page.n)) {
                throw new Error("MangaUnion: formato de cifrado no compatible.")
            }
            const key = this.decodeBase64(chapter.enc.key)
            const pages: ChapterPage[] = new Array(chapter.pages.length)
            let next = 0, failed = false
            // Keep the next downloads running while Goja decrypts completed images.
            await Promise.all(Array.from({ length: Math.min(8, chapter.pages.length) }, async () => {
                while (!failed) {
                    const index = next++
                    if (index >= chapter.pages.length) return
                    const page = chapter.pages[index]
                    try {
                        const url = this.imageUrl(page.url)
                        const options = { headers: { Referer: readerUrl, Origin: this.baseUrl }, timeout: 20 }
                        const res = await fetch(url, options)
                        if (!res.ok) throw new Error(`MangaUnion: HTTP ${res.status} al obtener una página.`)
                        // Seanime exposes the raw []byte as response.body. text() would corrupt binary data.
                        const body = (res as unknown as { body?: ArrayLike<number> }).body
                        if (!body || typeof body.length !== "number") {
                            throw new Error("MangaUnion: esta versión de Seanime no expone response.body para datos binarios.")
                        }
                        // Seanime's built-in Buffer converts []byte natively; no Node process is used.
                        const input = typeof Buffer === "undefined" ? new Uint8Array(body) : Buffer.from(body)
                        const bytes = this.chacha20(input, key, this.decodeBase64(page.n!))
                        const type = this.imageType(bytes)
                        // Empty headers make Seanime's reader use the embedded image directly.
                        pages[index] = { url: `data:${type};base64,${this.encodeBase64(bytes)}`, index, headers: {} }
                    } catch (error) {
                        failed = true
                        throw error
                    }
                }
            }))
            return pages
        }

        return chapter.pages.map((page, index) => {
            if (!/^https:\/\//i.test(page.url) || /\.bin(?:\?|$)/i.test(page.url)) {
                throw new Error("MangaUnion: página inválida o cifrada sin clave.")
            }
            return { url: page.url, index, headers: { Referer: readerUrl, Origin: this.baseUrl } }
        })
    }

    private async request<T>(path: string, referer: string): Promise<T> {
        const res = await fetch(`${this.api}${path}`, {
            headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0", Referer: referer, Origin: this.baseUrl },
        })
        if (!res.ok) throw new Error(`MangaUnion: HTTP ${res.status} en ${path}.`)
        const data = await res.json() as T
        if (!data || typeof data !== "object" || (path.indexOf("?") >= 0 && !Array.isArray((data as unknown as UnionList<unknown>).data))) {
            throw new Error("MangaUnion: respuesta inesperada de la API.")
        }
        return data
    }

    private mangaSlug(id: string): string {
        const slug = id.trim().replace(/^https:\/\/mangaunion\.com\/manga\//, "").replace(/\/$/, "")
        if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("MangaUnion: ID de manga inválido.")
        return slug
    }

    private chapterNumber(value: string | number): string {
        const raw = String(value)
        if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) {
            throw new Error("MangaUnion: número de capítulo inválido.")
        }
        return String(Number(raw))
    }

    private imageUrl(url: string): string {
        if (!/^https:\/\/(?:cdn\.budgethosting\.online|api\.mangaunion\.com)\//i.test(url)) {
            throw new Error("MangaUnion: host de imagen desconocido.")
        }
        return url
    }

    private imageType(bytes: Uint8Array): string {
        const signature = String.fromCharCode(...bytes.slice(0, 12))
        if (signature.slice(0, 4) === "RIFF" && signature.slice(8, 12) === "WEBP") return "image/webp"
        if (signature.slice(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png"
        if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg"
        if (/^GIF8[79]a/.test(signature)) return "image/gif"
        throw new Error("MangaUnion: la página descifrada no es una imagen válida.")
    }

    private decodeBase64(value: string): Uint8Array {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        const input = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
        if (!/^[A-Za-z0-9+/]*$/.test(input) || input.length % 4 === 1) throw new Error("MangaUnion: base64 inválido.")
        const bytes = new Uint8Array(Math.floor(input.length * 6 / 8))
        let bits = 0, buffer = 0, offset = 0
        for (let i = 0; i < input.length; i++) {
            buffer = (buffer << 6) | alphabet.indexOf(input[i])
            bits += 6
            if (bits >= 8) { bits -= 8; bytes[offset++] = (buffer >>> bits) & 255 }
        }
        return bytes
    }

    private encodeBase64(bytes: Uint8Array): string {
        // Seanime's native encoder avoids interpreting a large byte-to-string loop in Goja.
        if (typeof CryptoJS !== "undefined") {
            const encoded = CryptoJS.enc.Base64.stringify(bytes)
            if (encoded || !bytes.length) return encoded
        }
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        const chunks: string[] = []
        let chunk = ""
        for (let i = 0; i < bytes.length; i += 3) {
            const word = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
            chunk += alphabet[(word >>> 18) & 63] + alphabet[(word >>> 12) & 63]
                + (i + 1 < bytes.length ? alphabet[(word >>> 6) & 63] : "=")
                + (i + 2 < bytes.length ? alphabet[word & 63] : "=")
            if (chunk.length >= 16384) { chunks.push(chunk); chunk = "" }
        }
        chunks.push(chunk)
        return chunks.join("")
    }

    private chacha20(bytes: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
        if (key.length !== 32 || nonce.length !== 12) throw new Error("MangaUnion: clave o nonce ChaCha20 inválidos.")
        const word = (array: Uint8Array, i: number) => array[i] | (array[i + 1] << 8) | (array[i + 2] << 16) | (array[i + 3] << 24)
        const state = new Uint32Array(16)
        state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])
        for (let i = 0; i < 8; i++) state[4 + i] = word(key, i * 4)
        for (let i = 0; i < 3; i++) state[13 + i] = word(nonce, i * 4)
        const output = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
        output.set(bytes)
        const words = new Uint32Array(output.buffer)
        const s0 = state[0]
        const s1 = state[1]
        const s2 = state[2]
        const s3 = state[3]
        const s4 = state[4]
        const s5 = state[5]
        const s6 = state[6]
        const s7 = state[7]
        const s8 = state[8]
        const s9 = state[9]
        const s10 = state[10]
        const s11 = state[11]
        const s13 = state[13]
        const s14 = state[14]
        const s15 = state[15]
        let counter = 0
        // IETF ChaCha20, counter 0. Scalar rounds avoid costly per-word Goja calls.
        for (let offset = 0; offset < bytes.length; offset += 64) {
            let x0 = s0, x1 = s1, x2 = s2, x3 = s3
            let x4 = s4, x5 = s5, x6 = s6, x7 = s7
            let x8 = s8, x9 = s9, x10 = s10, x11 = s11
            let x12 = counter, x13 = s13, x14 = s14, x15 = s15
            for (let round = 0; round < 10; round++) {
                x0 = x0 + x4; x12 ^= x0; x12 = (x12 << 16) | (x12 >>> 16)
                x8 = x8 + x12; x4 ^= x8; x4 = (x4 << 12) | (x4 >>> 20)
                x0 = x0 + x4; x12 ^= x0; x12 = (x12 << 8) | (x12 >>> 24)
                x8 = x8 + x12; x4 ^= x8; x4 = (x4 << 7) | (x4 >>> 25)
                x1 = x1 + x5; x13 ^= x1; x13 = (x13 << 16) | (x13 >>> 16)
                x9 = x9 + x13; x5 ^= x9; x5 = (x5 << 12) | (x5 >>> 20)
                x1 = x1 + x5; x13 ^= x1; x13 = (x13 << 8) | (x13 >>> 24)
                x9 = x9 + x13; x5 ^= x9; x5 = (x5 << 7) | (x5 >>> 25)
                x2 = x2 + x6; x14 ^= x2; x14 = (x14 << 16) | (x14 >>> 16)
                x10 = x10 + x14; x6 ^= x10; x6 = (x6 << 12) | (x6 >>> 20)
                x2 = x2 + x6; x14 ^= x2; x14 = (x14 << 8) | (x14 >>> 24)
                x10 = x10 + x14; x6 ^= x10; x6 = (x6 << 7) | (x6 >>> 25)
                x3 = x3 + x7; x15 ^= x3; x15 = (x15 << 16) | (x15 >>> 16)
                x11 = x11 + x15; x7 ^= x11; x7 = (x7 << 12) | (x7 >>> 20)
                x3 = x3 + x7; x15 ^= x3; x15 = (x15 << 8) | (x15 >>> 24)
                x11 = x11 + x15; x7 ^= x11; x7 = (x7 << 7) | (x7 >>> 25)
                x0 = x0 + x5; x15 ^= x0; x15 = (x15 << 16) | (x15 >>> 16)
                x10 = x10 + x15; x5 ^= x10; x5 = (x5 << 12) | (x5 >>> 20)
                x0 = x0 + x5; x15 ^= x0; x15 = (x15 << 8) | (x15 >>> 24)
                x10 = x10 + x15; x5 ^= x10; x5 = (x5 << 7) | (x5 >>> 25)
                x1 = x1 + x6; x12 ^= x1; x12 = (x12 << 16) | (x12 >>> 16)
                x11 = x11 + x12; x6 ^= x11; x6 = (x6 << 12) | (x6 >>> 20)
                x1 = x1 + x6; x12 ^= x1; x12 = (x12 << 8) | (x12 >>> 24)
                x11 = x11 + x12; x6 ^= x11; x6 = (x6 << 7) | (x6 >>> 25)
                x2 = x2 + x7; x13 ^= x2; x13 = (x13 << 16) | (x13 >>> 16)
                x8 = x8 + x13; x7 ^= x8; x7 = (x7 << 12) | (x7 >>> 20)
                x2 = x2 + x7; x13 ^= x2; x13 = (x13 << 8) | (x13 >>> 24)
                x8 = x8 + x13; x7 ^= x8; x7 = (x7 << 7) | (x7 >>> 25)
                x3 = x3 + x4; x14 ^= x3; x14 = (x14 << 16) | (x14 >>> 16)
                x9 = x9 + x14; x4 ^= x9; x4 = (x4 << 12) | (x4 >>> 20)
                x3 = x3 + x4; x14 ^= x3; x14 = (x14 << 8) | (x14 >>> 24)
                x9 = x9 + x14; x4 ^= x9; x4 = (x4 << 7) | (x4 >>> 25)
            }
            const block = offset >>> 2
            words[block + 0] ^= x0 + s0
            words[block + 1] ^= x1 + s1
            words[block + 2] ^= x2 + s2
            words[block + 3] ^= x3 + s3
            words[block + 4] ^= x4 + s4
            words[block + 5] ^= x5 + s5
            words[block + 6] ^= x6 + s6
            words[block + 7] ^= x7 + s7
            words[block + 8] ^= x8 + s8
            words[block + 9] ^= x9 + s9
            words[block + 10] ^= x10 + s10
            words[block + 11] ^= x11 + s11
            words[block + 12] ^= x12 + counter
            words[block + 13] ^= x13 + s13
            words[block + 14] ^= x14 + s14
            words[block + 15] ^= x15 + s15
            counter++
        }
        return output.subarray(0, bytes.length)
    }
}

interface UnionList<T> {
    data: T[]
    meta?: { page: number; limit: number; total: number; totalPages: number }
}
interface UnionManga {
    slug: string
    title: string
    titleEng?: string | null
    titleRomaji?: string | null
    coverImage?: string | null
    year?: number | null
}
interface UnionChapter {
    number: number | string
    title?: string | null
    releaseDate?: string
}
interface UnionReader {
    chapter: {
        pageCount: number
        pages: { url: string; n?: string }[]
        enc?: { alg: string; key: string } | null
    }
}
