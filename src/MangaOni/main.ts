/// <reference path="./manga-provider.d.ts" />

class Provider {

    private baseUrl = "https://manga-oni.com"

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const query = (opts.query ?? "").trim()
        if (!query) return []

        const url = `${this.baseUrl}/buscar/?q=${encodeURIComponent(query)}`
        const res = await fetch(url, {
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "Mozilla/5.0",
            },
        })
        if (!res.ok) return []

        const html = await res.text()
        const results: SearchResult[] = []
        const seen = new Set<string>()

        const cardPattern = /<div class="_135yj[\s\S]*?<a href="https?:\/\/manga-oni\.com\/(manga|oneshot)\/([^"\/]+)\/"[^>]*itemprop="url"[^>]*>[\s\S]*?<img src="([^"]+)"[^>]*>[\s\S]*?<div class="_2NNxg"><a href="https?:\/\/manga-oni\.com\/(?:manga|oneshot)\/[^"\/]+\/"[^>]*>([^<]+)<\/a>/g
        let match: RegExpExecArray | null

        while ((match = cardPattern.exec(html)) !== null) {
            const kind = match[1]
            const slug = match[2]
            const image = match[3]
            const title = this._decodeHtml(match[4].trim())
            const id = `${kind}|${slug}`

            if (!slug || !title || seen.has(id)) continue
            seen.add(id)

            results.push({
                id,
                title,
                image,
                synonyms: [],
            })
        }

        return results
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const [kind, slug] = this._splitMangaId(id)

        const url = `${this.baseUrl}/${kind}/${slug}/`
        const res = await fetch(url, {
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "Mozilla/5.0",
                "Referer": this.baseUrl,
            },
        })

        if (!res.ok) return []

        const html = await res.text()

        const chapters: ChapterDetails[] = []
        const seenChapterIds = new Set<string>()

        const chapterPattern = /<a href="https?:\/\/manga-oni\.com\/lector\/([^\/"]+)\/(\d+)\/"[^>]*>[\s\S]*?(?:<span class="timeago"[^>]*data-num="([^"]*)"[^>]*><\/span>)?[\s\S]*?<h3 class="entry-title-h2">([^<]+)<\/h3>/g
        let match: RegExpExecArray | null

        while ((match = chapterPattern.exec(html)) !== null) {
            const chapterSlug = match[1]
            const chapterDbId = match[2]
            const chapterNumRaw = (match[3] ?? "").trim()
            const title = this._decodeHtml(match[4].trim())

            if (!chapterDbId || seenChapterIds.has(chapterDbId)) continue
            // Safety guard: only keep chapter links belonging to the current manga slug.
            if (chapterSlug !== slug) continue

            const chapterNumber = chapterNumRaw || this._extractChapterNumber(title) || chapterDbId
            seenChapterIds.add(chapterDbId)

            chapters.push({
                id: `${kind}|${slug}|${chapterDbId}`,
                url: `${this.baseUrl}/lector/${chapterSlug}/${chapterDbId}/`,
                title,
                chapter: chapterNumber,
                index: 0,
            })
        }

        chapters.sort((a, b) => {
            const an = this._toNumericChapter(a.chapter)
            const bn = this._toNumericChapter(b.chapter)

            if (an !== null && bn !== null && an !== bn) return an - bn
            if (an !== null && bn === null) return -1
            if (an === null && bn !== null) return 1

            const aDbId = parseInt(a.id.split("|")[2] ?? "0", 10)
            const bDbId = parseInt(b.id.split("|")[2] ?? "0", 10)
            return aDbId - bDbId
        })

        for (let i = 0; i < chapters.length; i++) {
            chapters[i].index = i
        }

        return chapters
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const [, slug, chapterDbId] = this._splitChapterId(id)
        const chapterUrl = `${this.baseUrl}/lector/${slug}/${chapterDbId}/`

        const res = await fetch(chapterUrl, {
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "Mozilla/5.0",
                "Referer": `${this.baseUrl}/manga/${slug}/`,
            },
        })
        if (!res.ok) return []

        const html = await res.text()
        const encoded = this._extractUnicap(html)
        if (!encoded) return []

        const decoded = this._decodeBase64(encoded)
        if (!decoded) return []

        const parts = decoded.split("||")
        if (parts.length < 2) return []

        let baseDir = parts[0].trim()
        if (!baseDir) return []
        if (!baseDir.endsWith("/")) baseDir += "/"

        const rawPages = parts[1].replace(/&quot;/g, '"')

        let pageFiles: unknown = []
        try {
            pageFiles = JSON.parse(rawPages)
        } catch {
            return []
        }

        if (!Array.isArray(pageFiles) || pageFiles.length === 0) return []

        const pages: ChapterPage[] = []

        for (let i = 0; i < pageFiles.length; i++) {
            const file = String(pageFiles[i] ?? "").trim().replace(/^\/+/, "")
            if (!file) continue

            pages.push({
                url: `${baseDir}${file}`,
                index: i,
                headers: {
                    "Referer": chapterUrl,
                    "Origin": this.baseUrl,
                },
            })
        }

        return pages
    }

    private _splitMangaId(id: string): [string, string] {
        const parts = id.split("|")
        if (parts.length >= 2) {
            const kind = parts[0] === "oneshot" ? "oneshot" : "manga"
            return [kind, parts[1]]
        }
        return ["manga", id]
    }

    private _splitChapterId(id: string): [string, string, string] {
        const parts = id.split("|")
        if (parts.length >= 3) {
            const kind = parts[0] === "oneshot" ? "oneshot" : "manga"
            return [kind, parts[1], parts[2]]
        }

        // Fallback for malformed IDs.
        const slug = parts[0] ?? ""
        const chapterDbId = parts[1] ?? ""
        return ["manga", slug, chapterDbId]
    }

    private _extractUnicap(html: string): string | null {
        const singleQuote = html.match(/var\s+unicap\s*=\s*'([^']+)'/)
        if (singleQuote?.[1]) return singleQuote[1]

        const doubleQuote = html.match(/var\s+unicap\s*=\s*"([^"]+)"/)
        if (doubleQuote?.[1]) return doubleQuote[1]

        return null
    }

    private _decodeBase64(input: string): string {
        try {
            if (typeof atob === "function") return atob(input)
        } catch {
            // ignore and fall back to manual decoder
        }

        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="
        let str = input.replace(/=+$/, "")
        let output = ""
        let bc = 0
        let bs = 0

        for (let idx = 0; idx < str.length; idx++) {
            const buffer = chars.indexOf(str.charAt(idx))
            if (buffer < 0) continue

            bs = bc % 4 ? bs * 64 + buffer : buffer
            if (bc++ % 4) {
                output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))
            }
        }

        return output
    }

    private _decodeHtml(text: string): string {
        return text
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
    }

    private _extractChapterNumber(title: string): string | null {
        const m = title.match(/cap[ií]tulo\s*([\d.,]+)/i)
        if (m?.[1]) return m[1].replace(",", ".")

        const anyNum = title.match(/([\d]+(?:[.,]\d+)?)/)
        if (anyNum?.[1]) return anyNum[1].replace(",", ".")

        return null
    }

    private _toNumericChapter(chapter: string): number | null {
        const normalized = chapter.trim().replace(",", ".")
        const num = parseFloat(normalized)
        return Number.isFinite(num) ? num : null
    }

}