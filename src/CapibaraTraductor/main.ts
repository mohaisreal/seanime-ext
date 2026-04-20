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
            let chapterNums = await this._fetchChaptersFromHtml(orgSlug, mangaSlug)
            if (!chapterNums.length) {
                chapterNums = item.chapters.map(c => c.number)
            }
            if (!chapterNums.length) continue

            console.log("[capibara] org=" + orgSlug + " chapters=" + chapterNums.length)

            for (const num of chapterNums) {
                all.push({
                    id: `${orgSlug}|${mangaSlug}|${num}`,
                    url: `${this.baseUrl}/${orgSlug}/manga/${mangaSlug}/chapters/${num}`,
                    title: `Capítulo ${num}`,
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

        const apiUrl = `${this.api}/manga-custom/${mangaSlug}/chapter/${chapterNum}/pages`
        const res = await fetch(apiUrl, {
            headers: {
                "Accept": "application/json",
                "x-organization": orgSlug,
            },
        })

        if (!res.ok) return []

        let json: any
        try { json = JSON.parse(await res.text()) } catch { return [] }

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

        return raw.map((p: CapibaraPage, index: number) => ({
            url: p.url ?? p.imageUrl ?? p.image ?? "",
            index: p.index !== undefined ? p.index : index,
            headers: { "Referer": this.baseUrl },
        }))
    }

    // ── Astro Island chapter extraction ───────────────────────────────────────

    private async _fetchChaptersFromHtml(orgSlug: string, mangaSlug: string): Promise<number[]> {
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
                return chapters.map((c: any) => c.number as number)
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
    url?: string
    imageUrl?: string
    image?: string
    index?: number
}
