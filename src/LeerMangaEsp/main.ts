/// <reference path="./manga-provider.d.ts" />

class Provider {

    private baseUrl = "https://mangalect.org"
    private imageBaseUrl = "https://mangalect.org/static/lect_assets/images/favicon.3c4a81cddcab.png"

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const query = (opts.query ?? "").trim()
        if (!query) return []

        const url = `${this.baseUrl}/api/buscar_mangas/?query=${encodeURIComponent(query)}&page=1&page_size=24`
        const res = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0",
                "Referer": `${this.baseUrl}/biblioteca/`,
            },
        })
        if (!res.ok) return []

        let json: LeerMangaSearchResponse
        try {
            json = await res.json() as LeerMangaSearchResponse
        } catch {
            return []
        }

        const items = Array.isArray(json.resultados) ? json.resultados : []
        const results: SearchResult[] = []
        const seen = new Set<string>()

        for (const item of items) {
            if (!item?.slug || seen.has(item.slug)) continue
            seen.add(item.slug)

            results.push({
                id: item.slug,
                title: item.titulo || item.slug,
                image: item.portada,
                synonyms: [],
            })
        }

        console.log(results)
        return results
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const slug = this._slugFromId(id)
        if (!slug) return []

        const mangaUrl = `${this.baseUrl}/info/${slug}/`
        const chapters: InternalChapter[] = []
        const seen = new Set<string>()
        let nextUrl = mangaUrl

        for (let page = 0; page < 25 && nextUrl; page++) {
            const res = await fetch(nextUrl, {
                headers: this._htmlHeaders(mangaUrl, page > 0),
            })
            if (!res.ok) break

            const html = await res.text()
            const found = this._parseChapters(html, mangaUrl)

            for (const chapter of found) {
                if (seen.has(chapter.id)) continue
                seen.add(chapter.id)
                chapters.push(chapter)
            }

            const more = this._extractMoreLink(html, nextUrl)
            if (!more || more === nextUrl) break
            nextUrl = more
        }

        return chapters.map((chapter, index) => ({
            id: chapter.id,
            url: chapter.url,
            title: chapter.title,
            chapter: chapter.chapter,
            index,
            updatedAt: chapter.updatedAt,
        }))
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const chapterUrl = this._chapterUrlFromId(id)
        if (!chapterUrl) return []

        const res = await fetch(chapterUrl, {
            headers: this._htmlHeaders(chapterUrl, false),
        })
        if (!res.ok) return []

        const html = await res.text()
        const pages: ChapterPage[] = []
        const seen = new Set<string>()
        const imgPattern = /<img[^>]*class="[^"]*manga-image[^"]*"[^>]*>|<img[^>]*\ssrc="[^"]+"[^>]*class="[^"]*manga-image[^"]*"[^>]*>/gi
        let match: RegExpExecArray | null

        while ((match = imgPattern.exec(html)) !== null) {
            const srcMatch = match[0].match(/\ssrc="([^"]+)"/i)
            if (!srcMatch?.[1]) continue

            const imageUrl = this._toAbsoluteUrl(this._decodeHtml(srcMatch[1]), chapterUrl)
            if (!imageUrl || seen.has(imageUrl)) continue
            if (!/\/pagina_\d+\.(?:webp|jpe?g|png)(?:\?|$)/i.test(imageUrl)) continue

            seen.add(imageUrl)
            pages.push({
                url: imageUrl,
                index: pages.length,
                headers: this._imageHeaders(chapterUrl),
            })
        }

        return pages
    }

    private _parseChapters(html: string, referer: string): InternalChapter[] {
        const chapters: InternalChapter[] = []
        const chapterPattern = /<a[^>]+href="([^"]+)"[^>]*class="[^"]*chapter-link[^"]*"[\s\S]*?<div[^>]*class="[^"]*chapter-title[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?(?:<div[^>]*class="[^"]*chapter-date[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi
        let match: RegExpExecArray | null

        while ((match = chapterPattern.exec(html)) !== null) {
            const url = this._toAbsoluteUrl(this._decodeHtml(match[1]), referer)
            if (!url) continue

            const title = this._cleanText(match[2]) || "Capítulo"
            const chapter = this._extractChapterNumber(title) || this._extractChapterNumber(url) || String(chapters.length + 1)
            const updatedAt = this._dateToIso(this._cleanText(match[3] ?? ""))

            chapters.push({
                id: this._chapterIdFromUrl(url),
                url,
                title,
                chapter,
                updatedAt,
            })
        }

        return chapters
    }

    private _extractMoreLink(html: string, referer: string): string {
        const match = html.match(/<a[^>]+id="more-link"[^>]+href="([^"]+)"/i)
        if (!match?.[1]) return ""
        return this._toAbsoluteUrl(this._decodeHtml(match[1]), referer)
    }

    private _slugFromId(id: string): string {
        const raw = (id ?? "").trim()
        if (!raw) return ""

        const fromUrl = raw.match(/\/manga\/([^\/?#]+)\/?/i)
        if (fromUrl?.[1]) return fromUrl[1]

        const fromChapter = raw.match(/\/leer-m\/([^\/?#]+)\//i)
        if (fromChapter?.[1]) return fromChapter[1]

        return raw.split("|")[0].replace(/^\/+|\/+$/g, "")
    }

    private _chapterUrlFromId(id: string): string {
        const raw = (id ?? "").trim()
        if (!raw) return ""

        if (raw.startsWith("http://") || raw.startsWith("https://")) {
            return raw
        }

        const [slug, chapter] = raw.split("|")
        if (!slug || !chapter) return ""
        return `${this.baseUrl}/leer-m/${slug}/${chapter}/`
    }

    private _chapterIdFromUrl(url: string): string {
        const match = url.match(/\/leer-m\/([^\/?#]+)\/([^\/?#]+)\/?/i)
        if (!match?.[1] || !match?.[2]) return url
        return `${match[1]}|${match[2]}`
    }

    private _htmlHeaders(referer: string, xhr: boolean): Record<string, string> {
        const headers: Record<string, string> = {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
        }
        if (xhr) headers["X-Requested-With"] = "fetch"
        return headers
    }

    private _imageHeaders(referer: string): Record<string, string> {
        return {
            "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
        }
    }

    private _toAbsoluteUrl(url: string, referer: string): string {
        const value = (url ?? "").trim()
        if (!value) return ""
        if (value.startsWith("//")) return `https:${value}`
        if (value.startsWith("http://") || value.startsWith("https://")) return value
        if (value.startsWith("/")) return `${this._originFromUrl(referer)}${value}`

        const base = referer.split("?")[0]
        const dir = base.endsWith("/") ? base : base.replace(/\/[^\/]*$/, "/")
        return `${dir}${value}`
    }

    private _originFromUrl(url: string): string {
        const match = url.match(/^https?:\/\/[^\/?#]+/i)
        return match?.[0] ?? this.baseUrl
    }

    private _extractChapterNumber(text: string): string | null {
        const normalized = (text ?? "").replace(/,/g, ".")
        const cap = normalized.match(/(?:cap[ií]tulo|chapter|chap|ch)\s*([0-9]+(?:\.[0-9]+)?)/i)
        if (cap?.[1]) return this._trimNumeric(cap[1])

        const any = normalized.match(/\/([0-9]+(?:\.[0-9]+)?)\/?(?:[?#]|$)/)
        if (any?.[1]) return this._trimNumeric(any[1])

        const fallback = normalized.match(/([0-9]+(?:\.[0-9]+)?)/)
        return fallback?.[1] ? this._trimNumeric(fallback[1]) : null
    }

    private _trimNumeric(value: string): string {
        return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
    }

    private _toNumber(value: string): number | null {
        const n = parseFloat((value ?? "").replace(",", "."))
        return Number.isFinite(n) ? n : null
    }

    private _dateToIso(value: string): string | undefined {
        if (!value) return undefined
        const time = Date.parse(value)
        return Number.isFinite(time) ? new Date(time).toISOString() : undefined
    }

    private _cleanText(text: string): string {
        return this._decodeHtml((text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    }

    private _decodeHtml(text: string): string {
        return (text ?? "")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#8217;/g, "'")
            .replace(/&#8211;/g, "-")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ")
    }

}

interface LeerMangaSearchResponse {
    resultados: LeerMangaItem[]
    page?: number
    page_size?: number
    total_pages?: number
    total_results?: number
}

interface LeerMangaItem {
    id: number
    slug: string
    titulo: string
    portada: string
    tipo?: string
    generos?: string[]
    ultimo_capitulo?: number
    demografia?: string
}

type InternalChapter = {
    id: string
    url: string
    title: string
    chapter: string
    updatedAt?: string
}
