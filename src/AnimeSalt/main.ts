/// <reference path="./online-streaming-provider.d.ts" />

type AnimeSaltSourceResponse = {
    hls?: boolean
    videoSource?: string
    securedLink?: string
    videoSources?: { file?: string; label?: string; type?: string }[]
    sources?: { file?: string } | { file?: string; label?: string; type?: string }[]
    tracks?: { file?: string; label?: string; kind?: string; default?: boolean }[]
}

type AnimeSaltMode = "sub" | "dub"

class Provider {

    baseUrl = "https://animesalt.me/"

    getSettings(): Settings {
        return {
            episodeServers: ["default"],
            supportsDub: true,
        }
    }

    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const res = await fetch(`${this.baseUrl}/?s=${encodeURIComponent(opts.query)}`, {
            credentials: "include",
            headers: this._siteHeaders(),
        })
        if (!res.ok) return []

        const html = await res.text()
        const results: SearchResult[] = []
        const seen = new Set<string>()
        const articlePattern = /<article\b[\s\S]*?<\/article>/g
        let articleMatch: RegExpExecArray | null

        while ((articleMatch = articlePattern.exec(html)) !== null) {
            const article = articleMatch[0]
            const hrefMatch = article.match(/<a[^>]+href=["'](https?:\/\/animesalt\.link\/(?:series|movies)\/[^"']+)["'][^>]*>/i)
            const titleMatch = article.match(/<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)
            if (!hrefMatch || !titleMatch) continue

            const url = this._normalizeUrl(hrefMatch[1])
            const title = this._stripTags(titleMatch[1])
            if (!title) continue

            const seasonNumber = this._inferSeasonNumber(opts)
            const partNumber = this._inferPartNumber(opts)
            const seasons = url.includes("/series/")
                ? await this._fetchSeriesSeasons(url)
                : []
            const searchSeasons = seasonNumber
                ? seasons.filter(season => season.season === seasonNumber)
                : seasons

            if (searchSeasons.length > 0) {
                for (const season of searchSeasons) {
                    const id = this._withMode(this._idFromUrl(url), opts.dub ? "dub" : "sub", opts.media?.episodeCount, season.season, partNumber)
                    if (!id || seen.has(id)) continue
                    seen.add(id)
                    results.push({
                        id,
                        title: `${title} - Season ${season.season}`,
                        url,
                        subOrDub: opts.dub ? "dub" : "sub",
                    })
                }
                continue
            }

            const id = this._withMode(this._idFromUrl(url), opts.dub ? "dub" : "sub", opts.media?.episodeCount, seasonNumber, partNumber)
            if (!id || seen.has(id)) continue
            seen.add(id)
            results.push({ id, title, url, subOrDub: opts.dub ? "dub" : "sub" })
        }

        return results
    }

    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const { contentId, mode, episodeCount, seasonNumber, partNumber } = this._parseMode(id)
        const url = `${this.baseUrl}/${contentId.replace(/^\/+|\/+$/g, "")}/`
        const res = await fetch(url, { credentials: "include", headers: this._siteHeaders() })
        if (!res.ok) return []

        const html = await res.text()

        if (contentId.startsWith("movies/")) {
            return [{
                id: this._episodeId(res.url, mode),
                number: 1,
                url: res.url,
                title: this._pageTitle(html) || "Movie",
            }]
        }

        const episodeMap = new Map<number, EpisodeDetails>()
        const slug = contentId.replace(/^series\//, "").replace(/\/+$/g, "")
        const seasons = this._extractSeasons(html)

        // The AnimeSalt series page can contain several Anime seasons on one page,
        // while Seanime asks for one AniList entry at a time. Prefer the explicit
        // season number inferred from AniList titles ("2nd Season", "Season 3"),
        // then fall back to episode count. Episode count alone is not enough:
        // Re:Zero has Season 1 and Season 2 both listed as 25 episodes on AnimeSalt.
        const explicitSeason = seasonNumber
            ? seasons.find(season => season.season === seasonNumber)
            : undefined
        const matchingSeasons = !explicitSeason && episodeCount
            ? seasons.filter(season => season.end - season.start + 1 === episodeCount)
            : []
        const selectedSeason = explicitSeason || matchingSeasons[0] || seasons[0]
        let siteStart = selectedSeason?.start || 1
        let siteEnd = selectedSeason?.end || Infinity
        if (selectedSeason && episodeCount && selectedSeason.end - selectedSeason.start + 1 > episodeCount) {
            if (partNumber && partNumber > 1) {
                siteStart = selectedSeason.end - episodeCount + 1
                siteEnd = selectedSeason.end
            } else {
                siteStart = selectedSeason.start
                siteEnd = selectedSeason.start + episodeCount - 1
            }
        }
        const allowedSeasons = new Set(selectedSeason ? [selectedSeason.season] : [])
        const shouldIncludeSeason = (season: number) => allowedSeasons.size === 0 || allowedSeasons.has(season)
        const addEpisode = (season: number, siteNumber: number, epUrl?: string, title?: string) => {
            if (!season || !siteNumber || !shouldIncludeSeason(season) || siteNumber < siteStart || siteNumber > siteEnd) return
            const number = siteNumber - siteStart + 1
            if (episodeMap.has(number)) return
            const url = epUrl || `${this.baseUrl}/episode/${slug}-${season}x${siteNumber}/`
            episodeMap.set(number, {
                id: this._episodeId(url, mode),
                number,
                url,
                title: title || `Season ${season} Episode ${siteNumber}`,
            })
        }

        // Prefer explicit episode URLs rendered by AnimeSalt; fill gaps from the
        // season range selector afterwards.
        const pattern = /href=["'](https?:\/\/animesalt\.link\/episode\/([^"']+?)-(\d+)x(\d+)\/)["']/gi
        let match: RegExpExecArray | null

        while ((match = pattern.exec(html)) !== null) {
            const epUrl = this._normalizeUrl(match[1])
            const season = parseInt(match[3])
            const number = parseInt(match[4])
            addEpisode(season, number, epUrl)
        }

        for (const season of seasons) {
            if (!shouldIncludeSeason(season.season)) continue
            for (let number = season.start; number <= season.end; number++) addEpisode(season.season, number)
        }

        return [...episodeMap.values()].sort((a, b) => a.number - b.number)
    }

    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const mode = this._episodeMode(episode)
        const res = await fetch(episode.url, { credentials: "include", headers: this._siteHeaders() })
        if (!res.ok) return { server, headers: {}, videoSources: [] }

        const html = await res.text()
        const candidates = this._orderedCandidates(this._extractIframeUrls(html), mode)

        for (const playerUrl of candidates) {
            const source = await this._resolvePlayer(playerUrl, episode.url, mode)
            if (source.videoSources.length > 0) return source
        }

        return { server, headers: {}, videoSources: [] }
    }

    private _orderedCandidates(urls: string[], mode: AnimeSaltMode): string[] {
        const asCdn = urls.filter(url => /https?:\/\/as-cdn\d+\.top\/video\//i.test(url))
        const megaPlay = urls.filter(url => /https?:\/\/megaplay\.buzz\/stream\//i.test(url))
        const exactMegaPlay = megaPlay.filter(url => new RegExp(`/${mode}(?:[/?#]|$)`, "i").test(url))
        const otherMegaPlay = megaPlay.filter(url => !exactMegaPlay.includes(url))

        // Prefer the explicit MegaPlay sub/dub iframe when the page exposes it:
        // it returns one clean stream plus VTT subtitles for subbed playback.
        // AS CDN is kept as a fallback for pages that only expose the multi-audio
        // player. Do not expose AS CDN and MegaPlay as two Seanime servers — that
        // creates duplicate "default" qualities for the same video.
        return [...exactMegaPlay, ...asCdn, ...otherMegaPlay]
    }

    private async _resolvePlayer(playerUrl: string, episodeUrl: string, mode: AnimeSaltMode): Promise<EpisodeServer> {
        if (/megaplay\.buzz\/stream\//i.test(playerUrl)) return this._resolveMegaPlay(playerUrl, mode)
        if (/as-cdn\d+\.top\/video\//i.test(playerUrl)) return this._resolveAsCdn(playerUrl, episodeUrl, mode)
        return { server: "unknown", headers: {}, videoSources: [] }
    }

    private async _resolveAsCdn(playerUrl: string, episodeUrl: string, mode: AnimeSaltMode): Promise<EpisodeServer> {
        const origin = this._originOf(playerUrl)
        const id = playerUrl.split("/video/")[1]?.split(/[?#]/)[0]
        if (!id) return { server: "AS CDN", headers: {}, videoSources: [] }

        const subtitles = mode === "sub" ? await this._extractAsCdnSubtitles(playerUrl) : []
        const body = `hash=${encodeURIComponent(id)}&r=${encodeURIComponent(episodeUrl)}`
        const res = await fetch(`${origin}/player/index.php?data=${encodeURIComponent(id)}&do=getVideo`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": playerUrl,
                "Origin": origin,
                "User-Agent": this._userAgent(),
            },
            body,
        })
        if (!res.ok) return { server: "AS CDN", headers: {}, videoSources: [] }

        const data = (await res.json()) as AnimeSaltSourceResponse
        const sources: VideoSource[] = []
        const seen = new Set<string>()
        const addSource = (url: string, quality = "auto") => {
            const clean = this._cleanUrl(url)
            if (!clean || seen.has(clean)) return
            seen.add(clean)
            sources.push({
                url: clean,
                type: this._videoType(clean),
                quality,
                label: mode === "dub" ? "Dub" : "Sub",
                subtitles,
            })
        }

        const direct = data.videoSource || data.securedLink
        if (direct) addSource(direct)

        if (Array.isArray(data.videoSources)) {
            for (const item of data.videoSources) {
                if (!item.file) continue
                addSource(item.file, item.label || "auto")
            }
        }

        return {
            server: "default",
            headers: { "Referer": `${origin}/`, "Origin": origin },
            videoSources: sources,
        }
    }

    private async _resolveMegaPlay(playerUrl: string, mode: AnimeSaltMode): Promise<EpisodeServer> {
        const origin = this._originOf(playerUrl)
        const embedRes = await fetch(playerUrl, {
            credentials: "include",
            headers: { "Referer": this.baseUrl + "/", "User-Agent": this._userAgent() },
        })
        if (!embedRes.ok) return { server: "MegaPlay", headers: {}, videoSources: [] }

        const html = await embedRes.text()
        const dataId = html.match(/data-id=["']([^"']+)["']/i)?.[1]
        if (!dataId) return { server: "MegaPlay", headers: {}, videoSources: [] }

        const res = await fetch(`${origin}/stream/getSources?id=${encodeURIComponent(dataId)}`, {
            headers: {
                "X-Requested-With": "XMLHttpRequest",
                "Referer": playerUrl,
                "User-Agent": this._userAgent(),
            },
        })
        if (!res.ok) return { server: "MegaPlay", headers: {}, videoSources: [] }

        const data = (await res.json()) as AnimeSaltSourceResponse
        const subtitles = mode === "sub" ? this._mapSubtitles(data.tracks || []) : []
        const sources: VideoSource[] = []
        const seen = new Set<string>()
        const addSource = (url: string, quality = "auto") => {
            const clean = this._cleanUrl(url)
            if (!clean || seen.has(clean)) return
            seen.add(clean)
            sources.push({
                url: clean,
                type: this._videoType(clean),
                quality,
                label: mode === "dub" ? "Dub" : "Sub",
                subtitles,
            })
        }

        if (!Array.isArray(data.sources) && data.sources?.file) {
            addSource(data.sources.file)
        }

        if (Array.isArray(data.sources)) {
            for (const item of data.sources) {
                if (!item.file) continue
                addSource(item.file, item.label || "auto")
            }
        }

        return {
            server: "default",
            headers: { "Referer": `${origin}/`, "Origin": origin },
            videoSources: sources,
        }
    }

    private async _extractAsCdnSubtitles(playerUrl: string): Promise<VideoSubtitle[]> {
        const res = await fetch(playerUrl, {
            credentials: "include",
            headers: { "Referer": this.baseUrl + "/", "User-Agent": this._userAgent() },
        })
        if (!res.ok) return []

        const html = await res.text()
        const raw = html.match(/playerjsSubtitle\s*=\s*"([^"]+)"/i)?.[1]
        if (!raw) return []

        const subtitles: VideoSubtitle[] = []
        for (const part of raw.split(",")) {
            const match = part.trim().match(/^\[([^\]]+)](.+)$/)
            if (!match) continue

            const language = this._htmlDecode(match[1]).trim()
            const url = this._cleanUrl(match[2])
            if (!language || !url) continue

            subtitles.push({
                id: `${language.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${subtitles.length + 1}`,
                url: this._subtitleUrl(url),
                language: this._subtitleLanguage(language),
                isDefault: subtitles.length === 0,
            })
        }

        return subtitles
    }

    private _subtitleUrl(url: string): string {
        const clean = this._cleanUrl(url)
        // AS CDN disguises plain SRT files as .jpg. The Seanime subtitle
        // pipeline can detect the content, but giving it a subtitle-looking
        // extension avoids edge cases in renderers/helpers that infer by URL.
        if (/https?:\/\/as-cdn\d+\.top\/p\/.+\.jpg(?:[?#].*)?$/i.test(clean)) {
            return clean.includes("?") || clean.includes("#") ? clean : `${clean}.srt`
        }
        return clean
    }

    private _subtitleLanguage(label: string): string {
        const normalized = label.trim().toLowerCase()
        const languages: { [key: string]: string } = {
            english: "en",
            japanese: "ja",
            spanish: "es",
            portuguese: "pt",
            french: "fr",
            german: "de",
            italian: "it",
            hindi: "hi",
            tamil: "ta",
            telugu: "te",
        }
        return languages[normalized] || normalized || "und"
    }

    private _extractIframeUrls(html: string): string[] {
        const urls: string[] = []
        const seen = new Set<string>()
        const pattern = /<iframe\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi
        let match: RegExpExecArray | null

        while ((match = pattern.exec(html)) !== null) {
            const url = this._absoluteUrl(this._htmlDecode(match[1]))
            if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
            seen.add(url)
            urls.push(url)
        }

        return urls
    }

    private _mapSubtitles(tracks: { file?: string; label?: string; kind?: string; default?: boolean }[]): VideoSubtitle[] {
        const subtitles: VideoSubtitle[] = []
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i]
            if (!track.file || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) continue
            subtitles.push({
                id: `${(track.label || "subtitle").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i + 1}`,
                url: this._subtitleUrl(track.file),
                language: this._subtitleLanguage(track.label || "Unknown"),
                isDefault: track.default === true,
            })
        }
        if (subtitles.length > 0 && !subtitles.some(subtitle => subtitle.isDefault)) {
            const english = subtitles.find(subtitle => subtitle.language.toLowerCase().includes("english"))
            ;(english || subtitles[0]).isDefault = true
        }
        return subtitles
    }

    private async _fetchSeriesSeasons(url: string): Promise<{ season: number; start: number; end: number }[]> {
        const res = await fetch(url, { credentials: "include", headers: this._siteHeaders() })
        if (!res.ok) return []
        return this._extractSeasons(await res.text())
    }

    private _extractSeasons(html: string): { season: number; start: number; end: number }[] {
        const seasons: { season: number; start: number; end: number }[] = []
        const seasonPattern = /Season\s*(\d+)\s*(?:•|&bull;|&#8226;)\s*(\d+)\s*-\s*(\d+)/gi
        let seasonMatch: RegExpExecArray | null

        while ((seasonMatch = seasonPattern.exec(html)) !== null) {
            const season = parseInt(seasonMatch[1])
            const start = parseInt(seasonMatch[2])
            const end = parseInt(seasonMatch[3])
            if (season && start && end && end >= start) seasons.push({ season, start, end })
        }

        return seasons
    }

    private _inferSeasonNumber(opts: SearchOptions): number | undefined {
        const values = [
            opts.query,
            opts.media?.englishTitle || "",
            opts.media?.romajiTitle || "",
            ...(opts.media?.synonyms || []),
        ]

        for (const value of values) {
            const normalized = value.toLowerCase()
            const seasonMatch =
                normalized.match(/\bseason\s+(\d+)\b/) ||
                normalized.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/) ||
                normalized.match(/\bs(\d+)\b/)
            if (seasonMatch) return parseInt(seasonMatch[1])
        }

        return undefined
    }

    private _inferPartNumber(opts: SearchOptions): number | undefined {
        const values = [
            opts.query,
            opts.media?.englishTitle || "",
            opts.media?.romajiTitle || "",
            ...(opts.media?.synonyms || []),
        ]

        for (const value of values) {
            const match = value.toLowerCase().match(/\bpart\s+(\d+)\b/)
            if (match) return parseInt(match[1])
        }

        return undefined
    }

    private _withMode(id: string, mode: AnimeSaltMode, episodeCount?: number, seasonNumber?: number, partNumber?: number): string {
        return `${mode}:${id}${episodeCount ? `::eps=${episodeCount}` : ""}${seasonNumber ? `::season=${seasonNumber}` : ""}${partNumber ? `::part=${partNumber}` : ""}`
    }

    private _parseMode(id: string): { mode: AnimeSaltMode; contentId: string; episodeCount?: number; seasonNumber?: number; partNumber?: number } {
        const [rawId, ...metadata] = id.split("::")
        const episodeCount = parseInt(metadata.find(item => item.startsWith("eps="))?.substring(4) || "") || undefined
        const seasonNumber = parseInt(metadata.find(item => item.startsWith("season="))?.substring(7) || "") || undefined
        const partNumber = parseInt(metadata.find(item => item.startsWith("part="))?.substring(5) || "") || undefined
        if (rawId.startsWith("dub:")) return { mode: "dub", contentId: rawId.substring(4), episodeCount, seasonNumber, partNumber }
        if (rawId.startsWith("sub:")) return { mode: "sub", contentId: rawId.substring(4), episodeCount, seasonNumber, partNumber }
        return { mode: "sub", contentId: rawId, episodeCount, seasonNumber, partNumber }
    }

    private _episodeId(url: string, mode: AnimeSaltMode): string {
        return `${mode}$${url}`
    }

    private _episodeMode(episode: EpisodeDetails): AnimeSaltMode {
        return episode.id.startsWith("dub$") ? "dub" : "sub"
    }

    private _idFromUrl(url: string): string {
        return url.replace(this.baseUrl, "").replace(/^\/+|\/+$/g, "")
    }

    private _pageTitle(html: string): string {
        const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
        return match ? this._stripTags(match[1]).replace(/\s+-\s+Anime Salt$/i, "") : ""
    }

    private _siteHeaders(): { [key: string]: string } {
        return {
            "User-Agent": this._userAgent(),
            "Referer": this.baseUrl + "/",
        }
    }

    private _userAgent(): string {
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    private _videoType(url: string): VideoSourceType {
        const clean = this._cleanUrl(url).split("?")[0].toLowerCase()
        if (clean.endsWith(".m3u8")) return "m3u8"
        if (clean.endsWith(".mp4")) return "mp4"
        return "unknown"
    }

    private _absoluteUrl(url: string): string {
        try {
            return new URL(this._cleanUrl(url), this.baseUrl).toString()
        } catch {
            return this._cleanUrl(url)
        }
    }

    private _originOf(url: string): string {
        try {
            return new URL(url).origin
        } catch {
            return this.baseUrl
        }
    }

    private _normalizeUrl(url: string): string {
        return this._cleanUrl(url).replace(/\/+$/, "/")
    }

    private _cleanUrl(url: string): string {
        return this._htmlDecode(url).replace(/\\\//g, "/").trim()
    }

    private _stripTags(value: string): string {
        return this._htmlDecode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    }

    private _htmlDecode(value: string): string {
        return value
            .replace(/&amp;/g, "&")
            .replace(/&#038;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
    }
}
