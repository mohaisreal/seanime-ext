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
        // id can be either the current format (manga.slug) or the legacy format
        // (orgSlug|mangaSlug|numericId) — extract the slug from whichever we receive
        const parts = id.split("|")
        const mangaSlug = parts.length >= 2 ? parts[1] : parts[0]
        console.log("[capibara] findChapters id=" + id + " mangaSlug=" + mangaSlug)

        // The API only matches short keywords reliably — use the first word of the slug,
        // then filter results by exact manga.slug to get the right entry
        const firstWord = mangaSlug.split("-")[0]
        const url = `${this.api}/manga-custom?page=1&limit=50&order=latest&nsfw=false&search=${encodeURIComponent(firstWord)}`
        const res = await fetch(url, { headers: { "Accept": "application/json" } })
        console.log("[capibara] search status=" + res.status + " query=" + firstWord)
        if (!res.ok) return []

        const json = await res.json() as CapibaraSearchResponse
        console.log("[capibara] items=" + (json.data?.items?.length ?? 0))
        if (!json.status || !json.data?.items?.length) return []

        // Prefer exact slug match; fall back to whatever the API returned for this query
        const matching = json.data.items.filter(i => i.manga.slug === mangaSlug)
        const items = matching.length > 0 ? matching : json.data.items
        console.log("[capibara] matching=" + matching.length + " using=" + items.length + " items")

        const all: ChapterDetails[] = []

        for (const item of items) {
            const orgSlug = item.organization.slug
            const orgName = item.organization.name
            const maxChapter = item.chapters.reduce((m, c) => Math.max(m, c.number), 0)
            console.log("[capibara] org=" + orgSlug + " maxChapter=" + maxChapter)
            if (maxChapter === 0) continue

            for (let i = 1; i <= maxChapter; i++) {
                all.push({
                    id: `${orgSlug}|${mangaSlug}|${i}`,
                    url: `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${i}`,
                    title: `Capítulo ${i}`,
                    chapter: String(i),
                    index: 0,          // recalculated below after sort
                    scanlator: orgName,
                })
            }
        }

        // Sort by chapter number ascending, then by scanlator name as tiebreaker
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
        console.log("[capibara] findChapterPages id=" + id)

        // Try the REST API first
        const apiUrl = `${this.api}/manga-custom/${mangaSlug}/chapter/${chapterNum}/pages`
        const res = await fetch(apiUrl, {
            headers: {
                "Accept": "application/json",
                "Referer": `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${chapterNum}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        })
        console.log("[capibara] pages API status=" + res.status)

        if (res.ok) {
            const text = await res.text()
            console.log("[capibara] pages API body=" + text.slice(0, 300))
            let json: any
            try { json = JSON.parse(text) } catch { json = null }

            let raw: CapibaraPage[] = []
            if (json !== null) {
                if (Array.isArray(json)) {
                    raw = json as CapibaraPage[]
                } else if (Array.isArray(json.data)) {
                    raw = json.data as CapibaraPage[]
                } else if (Array.isArray(json.pages)) {
                    raw = json.pages as CapibaraPage[]
                } else if (json.data && Array.isArray(json.data.pages)) {
                    raw = json.data.pages as CapibaraPage[]
                }
            }
            console.log("[capibara] raw pages count=" + raw.length)

            if (raw.length > 0) {
                return raw.map((p: CapibaraPage, index: number) => ({
                    url: p.url ?? p.imageUrl ?? p.image ?? "",
                    index: p.index !== undefined ? p.index : index,
                    headers: { "Referer": this.baseUrl },
                }))
            }
        }

        // Fallback: scrape each page URL (?page=N) and extract the chapter image from HTML
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
            console.log("[capibara] page=" + pageNum + " html length=" + html.length)

            // Log ALL r2 URLs found so we can identify the correct path pattern
            const allR2: string[] = []
            const r2Pattern = /(?:src|data-src|href)="(https:\/\/r2\.capibaratraductor\.com\/[^"]+)"/gi
            let r2Match: RegExpExecArray | null
            while ((r2Match = r2Pattern.exec(html)) !== null) {
                allR2.push(r2Match[1])
            }
            console.log("[capibara] page=" + pageNum + " r2 urls=" + JSON.stringify(allR2))

            // Match any r2 URL that isn't an org logo, manga cover, or banner
            const imgMatch = html.match(/(?:src|data-src)="(https:\/\/r2\.capibaratraductor\.com\/(?!organization\/|mangas\/)[^"]+)"/i)
            console.log("[capibara] page=" + pageNum + " img=" + (imgMatch ? imgMatch[1] : "none"))
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

        console.log("[capibara] scrape returned " + pages.length + " pages")
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
