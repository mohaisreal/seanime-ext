/// <reference path="./online-streaming-provider.d.ts" />

type ReAnimeTitle = {
    english?: string
    native?: string
    romaji?: string
    user_preferred?: string
}

type ReAnimeSearchItem = {
    anime_id: string
    title?: ReAnimeTitle
    subbed?: number
    dubbed?: number
    season_year?: number
    can_watch?: boolean
}

type ReAnimeSearchResponse = {
    results?: ReAnimeSearchItem[]
    hits?: ReAnimeSearchItem[]
    total?: number
}

type ReAnimeEpisode = {
    episode_number?: number
    number?: number
    episodeId?: string
    title?: string
    titles?: string[]
}

type ReAnimeEpisodeListResponse = {
    data?: ReAnimeEpisode[]
    episodes?: ReAnimeEpisode[]
    total?: number
}

type ReAnimeEpisodeLink = {
    $id?: string
    dataType?: "sub" | "dub" | "s-sub" | "s-dub" | string
    serverName?: string
    dataLink?: string
    continue?: boolean
    softsub?: boolean
}

type ReAnimeWatchResponse = {
    anime?: { anime_id?: string; sub_release?: { airing_at?: string; episode?: number } }
    episode_id?: string
    episode_links?: ReAnimeEpisodeLink[]
    current?: number
    duration?: number
    progress?: { episode_id?: string }
}

type DecodedDataNode = {
    anime?: { anime_id?: string; title?: ReAnimeTitle; subbed?: number; dubbed?: number; episodes?: number }
    episodes?: ReAnimeEpisodeListResponse
}

class Provider {

    baseUrl = "https://reanime.to"

    private _episodeCache = new Map<string, EpisodeDetails[]>()
    private _watchCache = new Map<string, ReAnimeWatchResponse>()
    private _resolvedLinkCache = new Map<string, VideoSource>()

    getSettings(): Settings {
        return {
            // Re:ANIME exposes episode links grouped by serverName. The site currently
            // prioritizes HD-2/HD-1 and keeps "maze" as its default client-side server.
            episodeServers: ["HD-2", "HD-1", "maze", "default"],
            supportsDub: true,
        }
    }

    private _headers(accept = "application/json,*/*"): { [key: string]: string } {
        return {
            "Accept": accept,
            "Referer": `${this.baseUrl}/`,
        }
    }

    private _title(title?: ReAnimeTitle): string {
        return title?.english || title?.user_preferred || title?.romaji || title?.native || "Unknown"
    }

    private _subOrDub(item: ReAnimeSearchItem): SubOrDub {
        const subbed = item.subbed || 0
        const dubbed = item.dubbed || 0
        if (subbed > 0 && dubbed > 0) return "both"
        if (dubbed > 0 && subbed === 0) return "dub"
        return "sub"
    }

    private async _json<T>(url: string, accept = "application/json,*/*"): Promise<T | null> {
        const res = await fetch(url, {
            credentials: "include",
            headers: this._headers(accept),
        })

        if (!res.ok) return null

        try {
            return (await res.json()) as T
        } catch {
            return null
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const queries = [
            opts.query,
            opts.media?.englishTitle,
            opts.media?.romajiTitle,
            ...(opts.media?.synonyms || []),
        ].filter((q, index, arr): q is string => !!q && arr.indexOf(q) === index)

        for (const query of queries) {
            const withYear = await this._searchQuery(query, opts.year, opts.dub)
            if (withYear.length > 0) return withYear

            if (opts.year) {
                const withoutYear = await this._searchQuery(query, undefined, opts.dub)
                if (withoutYear.length > 0) return withoutYear
            }
        }

        return []
    }

    private async _searchQuery(query: string, year?: number, preferDub = false): Promise<SearchResult[]> {
        const params = new URLSearchParams()
        params.set("q", query)
        params.set("limit", "10")
        params.set("offset", "0")
        if (year) params.set("year", String(year))

        const data = await this._json<ReAnimeSearchResponse>(`${this.baseUrl}/api/search?${params.toString()}`)
        const items = data?.results || data?.hits || []

        const results = items
            .filter(item => !!item.anime_id)
            .map(item => ({
                id: item.anime_id,
                title: this._title(item.title),
                url: `${this.baseUrl}/anime/${item.anime_id}`,
                subOrDub: this._subOrDub(item),
            }))

        if (!preferDub) return results

        return results.sort((a, b) => {
            const score = (result: SearchResult) => result.subOrDub === "dub" || result.subOrDub === "both" ? 0 : 1
            return score(a) - score(b)
        })
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const cached = this._episodeCache.get(id)
        if (cached) return cached

        let episodes = await this._findEpisodesViaApi(id)
        if (episodes.length === 0) {
            episodes = await this._findEpisodesViaDataRoute(id)
        }

        episodes = this._dedupeEpisodes(episodes)
        this._episodeCache.set(id, episodes)
        return episodes
    }

    private async _findEpisodesViaApi(id: string): Promise<EpisodeDetails[]> {
        const data = await this._json<ReAnimeEpisodeListResponse | ReAnimeEpisode[]>(
            `${this.baseUrl}/api/episodes/${encodeURIComponent(id)}`,
        )

        const rawEpisodes = Array.isArray(data)
            ? data
            : data?.data || data?.episodes || []

        return rawEpisodes
            .map(ep => this._toEpisodeDetails(id, ep))
            .filter((ep): ep is EpisodeDetails => !!ep)
            .sort((a, b) => a.number - b.number)
    }

    private async _findEpisodesViaDataRoute(id: string): Promise<EpisodeDetails[]> {
        const data = await this._json<{ nodes?: { data?: unknown[] }[] }>(
            `${this.baseUrl}/anime/${encodeURIComponent(id)}/__data.json`,
        )

        const root = this._decodeSvelteData(data?.nodes?.[1]?.data) as DecodedDataNode | null
        const canonicalId = root?.anime?.anime_id || id
        const rawEpisodes = root?.episodes?.data || []
        const episodes = rawEpisodes
            .map(ep => this._toEpisodeDetails(canonicalId, ep))
            .filter((ep): ep is EpisodeDetails => !!ep)

        // The Svelte data route may carry only the first page of episodes. If the
        // total is known, fill the missing numbers synthetically so Seanime can
        // still request /api/watch/{anime}/{episode} directly.
        const total = root?.episodes?.total || root?.anime?.episodes || 0
        if (total > episodes.length) {
            const seen = new Set(episodes.map(ep => ep.number))
            for (let number = 1; number <= total; number++) {
                if (seen.has(number)) continue
                episodes.push({
                    id: `${canonicalId}|${number}`,
                    number,
                    url: `${this.baseUrl}/watch/${canonicalId}?ep=${number}`,
                    title: `Episode ${number}`,
                })
            }
        }

        return episodes.sort((a, b) => a.number - b.number)
    }

    private _toEpisodeDetails(animeId: string, ep: ReAnimeEpisode): EpisodeDetails | null {
        const number = Number(ep.episode_number ?? ep.number)
        if (!Number.isFinite(number) || number <= 0 || !Number.isInteger(number)) return null

        const title = ep.title || ep.titles?.find(Boolean) || `Episode ${number}`

        return {
            id: `${animeId}|${number}`,
            number,
            url: `${this.baseUrl}/watch/${animeId}?ep=${number}`,
            title,
        }
    }

    private _dedupeEpisodes(episodes: EpisodeDetails[]): EpisodeDetails[] {
        const byNumber = new Map<number, EpisodeDetails>()
        for (const episode of episodes) {
            if (!byNumber.has(episode.number)) byNumber.set(episode.number, episode)
        }
        return [...byNumber.values()].sort((a, b) => a.number - b.number)
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const { animeId, number } = this._parseEpisodeId(episode)
        const cacheKey = `${animeId}|${number}`

        let watch = this._watchCache.get(cacheKey)
        if (!watch) {
            watch = await this._json<ReAnimeWatchResponse>(
                `${this.baseUrl}/api/watch/${encodeURIComponent(animeId)}/${number}?tz=UTC`,
            ) || undefined

            if (watch) this._watchCache.set(cacheKey, watch)
        }

        const links = this._selectLinks(watch?.episode_links || [], server)
        const videoSources: VideoSource[] = []

        for (const link of links) {
            const source = await this._toVideoSource(link)
            if (source) videoSources.push(source)
        }

        const selectedServer = links[0]?.serverName || (server === "default" ? "HD-2" : server)
        const refererOrigin = links[0]?.dataLink ? this._originOf(links[0].dataLink) : this.baseUrl

        return {
            server: selectedServer,
            headers: {
                "Referer": `${refererOrigin}/`,
                "Origin": refererOrigin,
            },
            videoSources,
        }
    }

    private _parseEpisodeId(episode: EpisodeDetails): { animeId: string; number: number } {
        const [animeId, rawNumber] = episode.id.split("|")
        if (animeId && rawNumber) {
            return { animeId, number: Number(rawNumber) || episode.number }
        }

        const urlMatch = episode.url.match(/\/watch\/([^/?#]+).*?[?&]ep=(\d+)/)
        if (urlMatch) {
            return { animeId: decodeURIComponent(urlMatch[1]), number: Number(urlMatch[2]) || episode.number }
        }

        return { animeId: animeId || episode.id, number: episode.number }
    }

    private _selectLinks(links: ReAnimeEpisodeLink[], server: string): ReAnimeEpisodeLink[] {
        const usable = links.filter(link => !!link.dataLink && !!link.serverName)
        if (usable.length === 0) return []

        const requested = server.toLowerCase()
        const isDefault = !server || requested === "default"
        const preferredServers = ["hd-2", "hd-1", "maze"]

        const byServer = usable.filter(link => link.serverName!.toLowerCase() === requested)
        const selected = isDefault
            ? preferredServers
                .map(name => usable.filter(link => link.serverName!.toLowerCase() === name))
                .find(group => group.length > 0) || []
            : byServer

        const fallback = selected.length > 0 ? selected : usable
        const sorted = fallback.sort((a, b) => this._languageRank(a.dataType) - this._languageRank(b.dataType))

        // Return one sub and one dub source when available. Seanime can then expose
        // both without needing a second API call.
        const picked: ReAnimeEpisodeLink[] = []
        for (const link of sorted) {
            const language = this._languageLabel(link.dataType)
            if (!picked.some(item => this._languageLabel(item.dataType) === language)) picked.push(link)
        }

        return picked.length > 0 ? picked : sorted.slice(0, 2)
    }

    private _languageRank(dataType?: string): number {
        if (dataType === "sub" || dataType === "s-sub") return 0
        if (dataType === "dub" || dataType === "s-dub") return 1
        return 2
    }

    private _languageLabel(dataType?: string): string {
        if (dataType === "dub" || dataType === "s-dub") return "Dub"
        if (dataType === "sub" || dataType === "s-sub") return "Sub"
        return "Unknown"
    }

    private async _toVideoSource(link: ReAnimeEpisodeLink): Promise<VideoSource | null> {
        if (!link.dataLink) return null

        const normalizedUrl = this._absoluteUrl(link.dataLink)
        const language = this._languageLabel(link.dataType)
        const quality = `${link.serverName || "Re:ANIME"} - ${language}${link.softsub ? " Softsub" : ""}`
        const cacheKey = `${normalizedUrl}|${quality}`

        const cached = this._resolvedLinkCache.get(cacheKey)
        if (cached) return cached

        const resolved = await this._resolveSourceUrl(normalizedUrl)
        const source: VideoSource = {
            url: resolved || normalizedUrl,
            type: this._videoType(resolved || normalizedUrl),
            quality,
            label: language,
            subtitles: [],
        }

        this._resolvedLinkCache.set(cacheKey, source)
        return source
    }

    private async _resolveSourceUrl(playerUrl: string): Promise<string | null> {
        if (this._videoType(playerUrl) !== "unknown") return playerUrl

        try {
            const res = await fetch(playerUrl, {
                credentials: "include",
                headers: this._headers("text/html,application/json,*/*"),
            })

            if (!res.ok) return null

            const contentType = res.headers.get("content-type") || ""
            const body = await res.text()

            if (contentType.includes("application/json")) {
                const direct = this._extractDirectUrlFromJson(body)
                if (direct) return direct
            }

            return this._extractDirectUrlFromHtml(body)
        } catch {
            return null
        }
    }

    private _extractDirectUrlFromJson(body: string): string | null {
        try {
            const data = JSON.parse(body)
            return this._deepFindVideoUrl(data)
        } catch {
            return null
        }
    }

    private _extractDirectUrlFromHtml(html: string): string | null {
        const candidates = [
            /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/,
            /["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*)["'`]/,
            /(?:file|source|src|url)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
        ]

        for (const pattern of candidates) {
            const match = html.match(pattern)
            if (match?.[1]) return this._cleanUrl(match[1])
        }

        return null
    }

    private _deepFindVideoUrl(value: unknown): string | null {
        if (typeof value === "string") {
            const clean = this._cleanUrl(value)
            return this._videoType(clean) !== "unknown" ? clean : null
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const found = this._deepFindVideoUrl(item)
                if (found) return found
            }
            return null
        }

        if (value && typeof value === "object") {
            for (const item of Object.values(value as Record<string, unknown>)) {
                const found = this._deepFindVideoUrl(item)
                if (found) return found
            }
        }

        return null
    }

    private _videoType(url: string): VideoSourceType {
        const clean = url.split("?")[0].toLowerCase()
        if (clean.endsWith(".m3u8")) return "m3u8"
        if (clean.endsWith(".mp4")) return "mp4"
        return "unknown"
    }

    private _absoluteUrl(url: string): string {
        const clean = this._cleanUrl(url)
        try {
            return new URL(clean, this.baseUrl).toString()
        } catch {
            return clean
        }
    }

    private _cleanUrl(url: string): string {
        return url
            .replace(/\\\//g, "/")
            .replace(/&amp;/g, "&")
            .trim()
    }

    private _originOf(url: string): string {
        try {
            return new URL(this._absoluteUrl(url)).origin
        } catch {
            return this.baseUrl
        }
    }

    private _decodeSvelteData(data?: unknown[]): unknown {
        if (!data || data.length === 0) return null

        const memo: Record<number, unknown> = {}

        const hydrate = (index: unknown): unknown => {
            if (typeof index !== "number") return index
            if (Object.prototype.hasOwnProperty.call(memo, index)) return memo[index]

            const value = data[index]

            if (Array.isArray(value)) {
                const out: unknown[] = []
                memo[index] = out
                for (const ref of value) out.push(hydrate(ref))
                return out
            }

            if (value && typeof value === "object") {
                const out: Record<string, unknown> = {}
                memo[index] = out
                for (const [key, ref] of Object.entries(value as Record<string, unknown>)) {
                    out[key] = hydrate(ref)
                }
                return out
            }

            return value
        }

        return hydrate(0)
    }
}
