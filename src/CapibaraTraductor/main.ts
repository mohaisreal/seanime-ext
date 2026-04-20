/// <reference path="./manga-provider.d.ts" />

class Provider {

    private baseUrl = "https://capibaratraductor.com"
    private api = "https://capibaratraductor.com/api"

    getSettings(): Settings {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
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

        const results: SearchResult[] = []
        for (const item of json.data.items) {
            const year = item.releasedAt ? new Date(item.releasedAt).getFullYear() : 0
            results.push({
                id: `${item.organization.slug}|${item.manga.slug}`,
                title: item.title,
                image: item.imageUrl ?? "",
                year: year || 0,
                synonyms: item.manga.title !== item.title ? [item.manga.title] : [],
            })
        }

        return results
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const [orgSlug, mangaSlug] = id.split("|")
        const pageUrl = `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}`

        const res = await fetch(pageUrl, {
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        })
        if (!res.ok) return []

        const html = await res.text()

        // Try to parse chapter list from Astro island props
        const chapters = this._parseChaptersFromAstroIslands(html, orgSlug, mangaSlug)
        if (chapters.length > 0) return chapters

        // Fallback: build sequential list from the last chapter link in the HTML
        return this._fallbackSequentialChapters(html, orgSlug, mangaSlug)
    }

    private _parseChaptersFromAstroIslands(html: string, orgSlug: string, mangaSlug: string): ChapterDetails[] {
        // Astro embeds island props as JSON in the props attribute.
        // We try single-quoted first, then double-quoted.
        const patterns = [
            /<astro-island[^>]+\sprops='([^']*)'[^>]*>/g,
            /<astro-island[^>]+\sprops="([^"]*)"/g,
        ]

        for (const pattern of patterns) {
            let match: RegExpExecArray | null
            while ((match = pattern.exec(html)) !== null) {
                try {
                    const raw = this._decodeHtmlEntities(match[1])
                    const props = JSON.parse(raw)
                    const chapters = this._extractChaptersFromProps(props, orgSlug, mangaSlug)
                    if (chapters.length > 0) return chapters
                } catch {}
            }
        }

        return []
    }

    private _extractChaptersFromProps(props: any, orgSlug: string, mangaSlug: string): ChapterDetails[] {
        // Astro serializes props as { key: [typeIndex, value] }.
        // We unwrap recursively to get plain values.
        const unwrap = (val: any): any => {
            if (Array.isArray(val) && val.length === 2 && typeof val[0] === "number" && val[0] < 10) {
                return unwrap(val[1])
            }
            if (Array.isArray(val)) return val.map(unwrap)
            if (val !== null && typeof val === "object") {
                const out: any = {}
                for (const k of Object.keys(val)) out[k] = unwrap(val[k])
                return out
            }
            return val
        }

        const unwrapped = unwrap(props)

        // Search any top-level key for an array of chapter objects
        for (const key of Object.keys(unwrapped ?? {})) {
            const candidate = unwrapped[key]
            if (!Array.isArray(candidate) || candidate.length === 0) continue
            if (typeof candidate[0]?.number !== "number") continue

            return this._buildChapterList(candidate as CapibaraChapter[], orgSlug, mangaSlug)
        }

        return []
    }

    private _buildChapterList(raw: CapibaraChapter[], orgSlug: string, mangaSlug: string): ChapterDetails[] {
        const sorted = [...raw].sort((a, b) => a.number - b.number)
        return sorted.map((ch, index) => ({
            id: `${orgSlug}|${mangaSlug}|${ch.number}`,
            url: `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${ch.number}`,
            title: ch.title ?? `Capítulo ${ch.number}`,
            chapter: String(ch.number),
            index,
            scanlator: orgSlug,
            updatedAt: ch.releasedAt ?? undefined,
        }))
    }

    private _fallbackSequentialChapters(html: string, orgSlug: string, mangaSlug: string): ChapterDetails[] {
        // Extract the highest chapter number from all /chapters/{n} links
        const linkPattern = /\/chapters\/(\d+)/g
        let match: RegExpExecArray | null
        let maxChapter = 0

        while ((match = linkPattern.exec(html)) !== null) {
            const n = parseInt(match[1])
            if (n > maxChapter) maxChapter = n
        }

        if (maxChapter === 0) return []

        const chapters: ChapterDetails[] = []
        for (let i = 1; i <= maxChapter; i++) {
            chapters.push({
                id: `${orgSlug}|${mangaSlug}|${i}`,
                url: `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${i}`,
                title: `Capítulo ${i}`,
                chapter: String(i),
                index: i - 1,
            })
        }

        return chapters
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const [orgSlug, mangaSlug, chapterNum] = id.split("|")

        // Try the REST API first
        const apiUrl = `${this.api}/manga-custom/${mangaSlug}/chapter/${chapterNum}/pages`
        const res = await fetch(apiUrl, {
            headers: {
                "Accept": "application/json",
                "Referer": `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${chapterNum}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        })

        if (res.ok) {
            const json = await res.json()
            const raw: CapibaraPage[] = Array.isArray(json)
                ? json
                : Array.isArray(json?.data) ? json.data
                : Array.isArray(json?.pages) ? json.pages
                : []

            if (raw.length > 0) {
                return raw.map((p, index) => ({
                    url: p.url ?? p.imageUrl ?? p.image ?? "",
                    index: p.index ?? index,
                    headers: { "Referer": this.baseUrl },
                }))
            }
        }

        // Fallback: scrape each page URL (?page=N) and extract the <img> from HTML
        return this._scrapePageByPage(orgSlug, mangaSlug, chapterNum)
    }

    private async _scrapePageByPage(orgSlug: string, mangaSlug: string, chapterNum: string): Promise<ChapterPage[]> {
        const chapterUrl = `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${chapterNum}`
        const pages: ChapterPage[] = []

        for (let pageNum = 1; pageNum <= 100; pageNum++) {
            const res = await fetch(`${chapterUrl}?page=${pageNum}`, {
                headers: {
                    "Accept": "text/html",
                    "Referer": this.baseUrl,
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
            })
            if (!res.ok) break

            const html = await res.text()

            // Image is hosted on r2.capibaratraductor.com
            const imgMatch = html.match(/src="(https:\/\/r2\.capibaratraductor\.com\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i)
            if (!imgMatch) break

            pages.push({
                url: imgMatch[1],
                index: pageNum - 1,
                headers: { "Referer": this.baseUrl },
            })

            // Stop if there is no link pointing to the next page
            const hasNextPage = html.includes(`?page=${pageNum + 1}`) ||
                html.includes(`/chapters/${chapterNum}?page=${pageNum + 1}`)
            if (!hasNextPage) break
        }

        return pages
    }

    private _decodeHtmlEntities(str: string): string {
        return str
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&amp;/g, "&")
            .replace(/&#38;/g, "&")
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
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
    url?: string
    imageUrl?: string
    image?: string
    index?: number
}
