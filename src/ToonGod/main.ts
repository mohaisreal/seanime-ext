/// <reference path="./manga-provider.d.ts" />

class Provider {

    private baseUrl = "https://www.toongod.org"
    private mangaSubString = "webtoons"

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const query = (opts.query ?? "").trim()
        if (!query) return []

        const url = `${this.baseUrl}/?s=${encodeURIComponent(query)}&post_type=wp-manga`
        const res = await fetch(url, {
            headers: this._htmlHeaders(`${this.baseUrl}/`),
        })
        if (!res.ok) return []

        const html = await res.text()
        const results: SearchResult[] = []
        const seen = new Set<string>()

        const titlePattern = /<(?:h1|h2|h3|h4|div)[^>]*class="[^"]*(?:post-title|h4)[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
        let match: RegExpExecArray | null

        while ((match = titlePattern.exec(html)) !== null) {
            const mangaUrl = this._normalizeMangaUrl(this._decodeHtml(match[1].trim()))
            const title = this._cleanText(match[2])

            if (!mangaUrl || !title || seen.has(mangaUrl)) continue
            seen.add(mangaUrl)

            const snippetStart = Math.max(0, match.index - 1500)
            const snippet = html.slice(snippetStart, match.index + 600)

            results.push({
                id: mangaUrl,
                title,
                image: this._extractImage(snippet),
                synonyms: [],
            })
        }

        if (results.length > 0) return results

        // Fallback: extract any direct manga links in case markup changed.
        const linkPattern = /<a[^>]*href="([^"]+)"[^>]*>([^<]{2,})<\/a>/gi
        while ((match = linkPattern.exec(html)) !== null) {
            const mangaUrl = this._normalizeMangaUrl(this._decodeHtml(match[1].trim()))
            const title = this._cleanText(match[2])

            if (!mangaUrl || !title || seen.has(mangaUrl)) continue
            seen.add(mangaUrl)

            results.push({
                id: mangaUrl,
                title,
                synonyms: [],
            })
        }

        return results
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const mangaUrl = this._resolveMangaUrl(id)

        const mangaRes = await fetch(mangaUrl, {
            headers: this._htmlHeaders(`${this.baseUrl}/`),
        })
        if (!mangaRes.ok) return []

        const mangaHtml = await mangaRes.text()
        let chapters = this._parseChapterList(mangaHtml)

        if (!chapters.length) {
            const dataId = this._extractMangaDataId(mangaHtml)
            const mangaBase = mangaUrl.replace(/\/+$/, "")

            if (dataId) {
                const oldRes = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
                    method: "POST",
                    headers: this._xhrHeaders(mangaUrl),
                    body: `action=manga_get_chapters&manga=${encodeURIComponent(dataId)}`,
                })

                if (oldRes.ok) {
                    chapters = this._parseChapterList(await oldRes.text())
                }

                // Newer Madara sites may reject the old endpoint with 400.
                if (!chapters.length || oldRes.status === 400) {
                    const newRes = await fetch(`${mangaBase}/ajax/chapters`, {
                        method: "POST",
                        headers: this._xhrHeaders(mangaUrl),
                    })

                    if (newRes.ok) {
                        chapters = this._parseChapterList(await newRes.text())
                    }
                }
            }
        }

        if (!chapters.length) return []

        const ordered = this._orderChaptersAscending(chapters)
        for (let i = 0; i < ordered.length; i++) {
            ordered[i].index = i
        }

        return ordered
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const chapterUrl = this._resolveChapterUrl(id)

        const res = await fetch(chapterUrl, {
            headers: this._htmlHeaders(chapterUrl),
        })
        if (!res.ok) return []

        const html = await res.text()

        const pages: ChapterPage[] = []
        const seen = new Set<string>()
        const imageRegexes = [
            /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)="([^"]+)"/gi,
            /<li[^>]*class="[^"]*blocks-gallery-item[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)="([^"]+)"/gi,
            /<img[^>]*class="[^"]*wp-manga-chapter-img[^"]*"[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)="([^"]+)"/gi,
        ]

        for (const regex of imageRegexes) {
            let match: RegExpExecArray | null
            while ((match = regex.exec(html)) !== null) {
                const imageUrl = this._normalizeImageUrl(this._decodeHtml(match[1]), chapterUrl)
                if (!imageUrl || seen.has(imageUrl)) continue
                seen.add(imageUrl)

                pages.push({
                    url: imageUrl,
                    index: pages.length,
                    headers: {
                        Referer: chapterUrl,
                        Origin: this.baseUrl,
                    },
                })
            }
        }

        if (pages.length > 0) return pages

        // Fallback: use any image inside reading-content.
        const fallbackImagePattern = /<div[^>]*class="[^"]*reading-content[^"]*"[^>]*>[\s\S]*?<\/div>/gi
        let blockMatch: RegExpExecArray | null

        while ((blockMatch = fallbackImagePattern.exec(html)) !== null) {
            const block = blockMatch[0]
            const imgPattern = /<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)="([^"]+)"/gi
            let imgMatch: RegExpExecArray | null

            while ((imgMatch = imgPattern.exec(block)) !== null) {
                const imageUrl = this._normalizeImageUrl(this._decodeHtml(imgMatch[1]), chapterUrl)
                if (!imageUrl || seen.has(imageUrl)) continue
                seen.add(imageUrl)

                pages.push({
                    url: imageUrl,
                    index: pages.length,
                    headers: {
                        Referer: chapterUrl,
                        Origin: this.baseUrl,
                    },
                })
            }
        }

        return pages
    }

    private _resolveMangaUrl(id: string): string {
        const value = id.trim()

        if (value.startsWith("http://") || value.startsWith("https://")) {
            const normalized = this._normalizeMangaUrl(value)
            if (normalized) return normalized

            const fallback = value.split("#")[0]
            return fallback.endsWith("/") ? fallback : `${fallback}/`
        }

        const slug = value
            .split("|")
            .pop()
            ?.trim()
            .replace(/^\/+|\/+$/g, "") ?? ""

        return `${this.baseUrl}/${this.mangaSubString}/${slug}/`
    }

    private _resolveChapterUrl(id: string): string {
        let raw = id.trim()

        if (raw.includes("|")) {
            const last = raw.split("|").pop()
            if (last) raw = last
        }

        if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
            raw = `${this.baseUrl}/${raw.replace(/^\/+/, "")}`
        }

        return this._normalizeChapterUrl(raw)
    }

    private _normalizeMangaUrl(url: string): string {
        const absolute = this._toAbsoluteUrl(url, `${this.baseUrl}/`)
        if (!absolute) return ""

        const clean = absolute.split("#")[0].split("?")[0]
        const ok = /\/((webtoon|webtoons|manga))\/[a-z0-9-]+\/?$/i.test(clean)
        if (!ok) return ""

        return clean.endsWith("/") ? clean : `${clean}/`
    }

    private _normalizeChapterUrl(url: string): string {
        let clean = this._toAbsoluteUrl(url, `${this.baseUrl}/`)
        if (!clean) return ""

        clean = clean.split("#")[0]
        clean = clean.replace(/([?&])style=paged\b/gi, "$1")
        clean = clean.replace(/[?&]$/, "")

        if (!/[?&]style=list\b/i.test(clean)) {
            clean += clean.includes("?") ? "&style=list" : "?style=list"
        }

        return clean
    }

    private _extractImage(snippet: string): string {
        const imgMatch = snippet.match(/<img[^>]+(?:data-src|data-lazy-src|data-cfsrc|src)="([^"]+)"/i)
        if (!imgMatch?.[1]) return ""
        return this._normalizeImageUrl(this._decodeHtml(imgMatch[1]), `${this.baseUrl}/`) || ""
    }

    private _extractMangaDataId(html: string): string {
        const match = html.match(/<div[^>]*id="manga-chapters-holder[^\"]*"[^>]*data-id="(\d+)"/i)
        if (match?.[1]) return match[1]

        const loose = html.match(/data-id="(\d+)"[^>]*id="manga-chapters-holder/i)
        return loose?.[1] ?? ""
    }

    private _parseChapterList(html: string): InternalChapter[] {
        const chapters: InternalChapter[] = []

        const itemPattern = /<li[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
        let item: RegExpExecArray | null

        while ((item = itemPattern.exec(html)) !== null) {
            const block = item[1]
            const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
            if (!linkMatch?.[1]) continue

            const chapterUrl = this._normalizeChapterUrl(this._decodeHtml(linkMatch[1]))
            if (!chapterUrl) continue

            const title = this._cleanText(linkMatch[2]) || "Chapter"
            const chapter = this._extractChapterNumber(title) || this._extractChapterNumber(chapterUrl) || String(chapters.length + 1)

            chapters.push({
                id: chapterUrl,
                url: chapterUrl,
                title,
                chapter,
                index: 0,
            })
        }

        return chapters
    }

    private _orderChaptersAscending(chapters: InternalChapter[]): InternalChapter[] {
        const enriched = chapters.map((c, i) => ({
            chapter: c,
            position: i,
            numeric: this._toNumeric(c.chapter),
        }))

        const numericCount = enriched.filter(e => e.numeric !== null).length

        if (numericCount >= Math.max(2, Math.floor(chapters.length * 0.6))) {
            enriched.sort((a, b) => {
                if (a.numeric !== null && b.numeric !== null && a.numeric !== b.numeric) {
                    return a.numeric - b.numeric
                }
                if (a.numeric !== null && b.numeric === null) return -1
                if (a.numeric === null && b.numeric !== null) return 1
                return a.position - b.position
            })
            return enriched.map(e => e.chapter)
        }

        return chapters.slice().reverse()
    }

    private _normalizeImageUrl(url: string, referer: string): string {
        return this._toAbsoluteUrl(url, referer)
    }

    private _toAbsoluteUrl(url: string, referer: string): string {
        let value = (url ?? "").trim()
        if (!value) return ""

        if (value.startsWith("//")) {
            return `https:${value}`
        }

        if (value.startsWith("http://") || value.startsWith("https://")) {
            return value
        }

        if (value.startsWith("/")) {
            return `${this.baseUrl}${value}`
        }

        const base = referer.split("?")[0]
        const dir = base.endsWith("/") ? base : base.replace(/\/[^\/]*$/, "/")
        return `${dir}${value}`
    }

    private _extractChapterNumber(text: string): string | null {
        const normalized = text.toLowerCase().replace(/,/g, ".")

        const chapterMatch = normalized.match(/(?:chapter|chap|ch)\s*([0-9]+(?:\.[0-9]+)?)/i)
        if (chapterMatch?.[1]) return chapterMatch[1]

        const anyNumber = normalized.match(/([0-9]+(?:\.[0-9]+)?)/)
        if (anyNumber?.[1]) return anyNumber[1]

        return null
    }

    private _toNumeric(value: string): number | null {
        const n = parseFloat((value ?? "").trim().replace(",", "."))
        return Number.isFinite(n) ? n : null
    }

    private _cleanText(text: string): string {
        return this._decodeHtml(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    }

    private _decodeHtml(text: string): string {
        return text
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

    private _htmlHeaders(referer: string): Record<string, string> {
        return {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
            "Origin": this.baseUrl,
        }
    }

    private _xhrHeaders(referer: string): Record<string, string> {
        return {
            "Accept": "text/html, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
            "Origin": this.baseUrl,
            "X-Requested-With": "XMLHttpRequest",
        }
    }

}

type InternalChapter = {
    id: string
    url: string
    title: string
    chapter: string
    index: number
}
