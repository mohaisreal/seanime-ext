/// <reference path="./online-streaming-provider.d.ts" />

class Provider {

    baseUrl = "https://tioanime.com"

    getSettings(): Settings {
        return {
            // Servers sourced from TioAnime's `var videos` array.
            // Amus and Mepu are their own CDN; the rest are third-party embeds.
            episodeServers: ["Amus", "Mepu", "YourUpload", "Okru", "StreamSB"],
            supportsDub: false,
        }
    }

    /**
     * Searches TioAnime via the `/directorio?q=` endpoint.
     * Results are rendered as `<li><a href="/anime/slug"><h3>Title</h3></a></li>`.
     */
    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = encodeURIComponent(opts.query)
        const url = `${this.baseUrl}/directorio?q=${query}`

        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) return []

        const html = await res.text()

        const results: SearchResult[] = []
        // Capture the slug from href="/anime/[slug]" and the title from the <h3>.
        const pattern = /<a\s+href="\/anime\/([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g
        let match: RegExpExecArray | null

        while ((match = pattern.exec(html)) !== null) {
            const id = match[1].replace(/\/+$/, "").trim()
            const title = match[2].trim()
            if (!id || !title) continue
            results.push({ id, title, url: `${this.baseUrl}/anime/${id}`, subOrDub: "sub" })
        }

        return results
    }

    /**
     * Fetches the anime detail page and extracts the episode list.
     *
     * TioAnime renders episodes client-side via a JS array embedded in the page:
     *   `var episodes = [220, 219, ..., 1];`
     * Each number maps to a URL of the form `/ver/{slug}-{number}`.
     */
    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const url = `${this.baseUrl}/anime/${id}`

        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) return []

        const html = await res.text()

        // Extract the episodes array from the embedded JS.
        const match = html.match(/var\s+episodes\s*=\s*(\[[^\]]+\])/)
        if (!match) return []

        let numbers: number[]
        try {
            numbers = JSON.parse(match[1])
        } catch {
            return []
        }

        return numbers
            .map(n => ({
                id: `${id}/${n}`,
                number: n,
                url: `${this.baseUrl}/ver/${id}-${n}`,
                title: `Episodio ${n}`,
            }))
            .sort((a, b) => a.number - b.number)
    }

    /**
     * Parses the `var videos = [["ServerName","embedUrl",0,0], ...]` JS variable
     * embedded in each episode page. Returns a map of server name → embed URL.
     *
     * Uses a per-entry regex rather than parsing the full outer array, which is
     * more resilient to formatting differences across pages.
     */
    private _extractPlayerUrls(html: string): Record<string, string> {
        const map: Record<string, string> = {}

        // Match each ["ServerName","https://..."] pair inside the videos array.
        // URLs may use JS-escaped slashes (https:\/\/), so we unescape after capturing.
        const pattern = /\["([^"]+)"\s*,\s*"(https?:[^"]+)"/g
        for (const [, name, rawUrl] of html.matchAll(pattern)) {
            const url = rawUrl.replace(/\\\//g, "/")
            if (!(name in map)) map[name] = url
        }

        return map
    }

    /**
     * Resolves a player embed URL to a direct stream URL.
     *
     * TioAnime's own CDN (v.tioanime.com/embed.php) and most third-party embeds
     * expose the stream as an m3u8 or mp4 URL in their page source.
     */
    private async _resolveStream(playerUrl: string): Promise<VideoSource | null> {
        const res = await fetch(playerUrl, {
            credentials: "include",
            headers: { "Referer": this.baseUrl + "/" },
        })

        if (!res.ok) return null

        const html = await res.text()

        // HLS playlist — preferred over mp4 for adaptive bitrate support.
        const m3u8Match = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)[`'"]/)
        if (m3u8Match) return { url: m3u8Match[1], type: "m3u8", quality: "default", subtitles: [] }

        const mp4Match = html.match(/["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*)[`'"]/)
        if (mp4Match) return { url: mp4Match[1], type: "mp4", quality: "default", subtitles: [] }

        return null
    }

    /**
     * Fetches the episode page, extracts available player URLs, selects the
     * requested server (or falls back to the first available), and resolves
     * the direct stream URL.
     */
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        const res = await fetch(episode.url, { credentials: "include" })
        if (!res.ok) return { server, headers: {}, videoSources: [] }

        const html = await res.text()

        const playerMap = this._extractPlayerUrls(html)

        if (Object.keys(playerMap).length === 0) {
            return { server, headers: {}, videoSources: [] }
        }

        // Build a priority-ordered list of candidate URLs to try.
        // Exact server match goes first, then preferred scrapeable servers,
        // then everything else (Mega last — it requires auth and can't be scraped).
        const PREFERRED = ["Amus", "Mepu", "YourUpload", "Okru", "StreamSB"]
        const candidates: string[] = []
        if (playerMap[server]) candidates.push(playerMap[server])
        for (const s of PREFERRED) {
            if (playerMap[s] && !candidates.includes(playerMap[s])) candidates.push(playerMap[s])
        }
        for (const url of Object.values(playerMap)) {
            if (!candidates.includes(url)) candidates.push(url)
        }

        // Try each candidate until one resolves a valid stream.
        let source: VideoSource | null = null
        let winningPlayerUrl: string | null = null
        for (const playerUrl of candidates) {
            source = await this._resolveStream(playerUrl)
            if (source) {
                winningPlayerUrl = playerUrl
                break
            }
        }

        // Use the winning embed's origin as Referer so the CDN accepts manifest requests.
        const streamOrigin = winningPlayerUrl
            ? new URL(winningPlayerUrl).origin
            : this.baseUrl

        return {
            server,
            headers: {
                "Referer": streamOrigin + "/",
                "Origin": streamOrigin,
            },
            videoSources: source ? [source] : [],
        }
    }
}
