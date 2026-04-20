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
                // id encodes orgSlug|mangaSlug|numericId so findChapters can use all three
                id: `${item.organization.slug}|${item.manga.slug}|${item.id}`,
                title: item.title,
                image: item.imageUrl ?? "",
                year: year || 0,
                synonyms: item.manga.title !== item.title ? [item.manga.title] : [],
            })
        }

        return results
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const [orgSlug, mangaSlug, numericId] = id.split("|")

        // Re-query the search API using the manga slug — no HTML fetch needed.
        // The response includes the 2 latest chapters; the highest number is our ceiling.
        const url = `${this.api}/manga-custom?page=1&limit=25&order=latest&nsfw=false&search=${encodeURIComponent(mangaSlug)}`
        const res = await fetch(url, { headers: { "Accept": "application/json" } })
        if (!res.ok) return []

        const json = await res.json() as CapibaraSearchResponse
        if (!json.status || !json.data?.items?.length) return []

        // Match by numeric ID so we pick the right entry when multiple scans share the same slug
        const item = json.data.items.find(i => String(i.id) === numericId)
            ?? json.data.items.find(i => i.manga.slug === mangaSlug)
        if (!item) return []

        // chapters[] holds the 2 most-recent entries; the first is the latest
        const maxChapter = item.chapters.reduce((m, c) => Math.max(m, c.number), 0)
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
