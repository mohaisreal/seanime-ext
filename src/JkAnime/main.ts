/// <reference path="./online-streaming-provider.d.ts" />

class Provider {

    baseUrl = "https://jkanime.net"

    getSettings(): Settings {
        return {
            episodeServers: ["JK", "Desu", "Okru", "YourUpload", "StreamWish", "DoodStream", "FileMoon", "Voe"],
            supportsDub: false,
        }
    }

    /**
     * Strips the base URL and leading/trailing slashes from a full href,
     * returning a clean relative ID (e.g. "shingeki-no-kyojin").
     */
    private _cleanId(href: string): string {
        return href
            .replace(this.baseUrl, "")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "")
    }

    /**
     * Searches JKAnime for anime matching the given query.
     * Scrapes the search results page and extracts title + ID from each
     * `.anime__item__text` anchor.
     */
    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const query = encodeURIComponent(opts.query)
        const url = `${this.baseUrl}/buscar/${query}/`

        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) return []

        const html = await res.text()

        const results: SearchResult[] = []
        // Each result block contains a link inside .anime__item__text; capture href and title.
        const pattern = /class="anime__item__text"[\s\S]*?<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
        let match: RegExpExecArray | null

        while ((match = pattern.exec(html)) !== null) {
            const href = match[1].trim()
            // Strip any inline tags from the title (e.g. <span> badges).
            const title = match[2].replace(/<[^>]+>/g, "").trim()
            const id = this._cleanId(href)
            if (!id || !title) continue
            results.push({ id, title, url: `${this.baseUrl}/${id}/`, subOrDub: "sub" })
        }

        return results
    }

    /**
     * Fetches all episodes via JKAnime's AJAX pagination endpoint.
     *
     * JKAnime renders episode lists client-side, so the static HTML only contains
     * the latest episode. All episodes are available through:
     *   /ajax/pagination_episodes/{idserie}/{page}/  (10 episodes per page, JSON)
     *
     * The numeric `idserie` is embedded in the series page HTML.
     * Falls back to static HTML scraping if the AJAX path fails or returns empty.
     */
    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        const url = `${this.baseUrl}/${id}/`
        console.log(`[JK:findEpisodes] fetching: ${url}`)

        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) {
            console.log(`[JK:findEpisodes] page fetch failed: ${res.status}`)
            return []
        }

        const html = await res.text()
        console.log(`[JK:findEpisodes] page html length: ${html.length}`)

        // Extract the numeric series ID used by the AJAX pagination endpoint.
        const seriesIdMatch = html.match(/ajax\/pagination_episodes\/(\d+)\//)
        console.log(`[JK:findEpisodes] seriesIdMatch: ${seriesIdMatch ? seriesIdMatch[1] : "NOT FOUND"}`)

        if (seriesIdMatch) {
            const seriesId = seriesIdMatch[1]

            const totalMatch =
                html.match(/num_episodios\s*=\s*(\d+)/) ??
                html.match(/Episodios:<\/span>[^<]*?(\d+)/) ??
                html.match(/data-episodes="(\d+)"/) ??
                html.match(/num-episodios[^>]*>\s*(\d+)/) ??
                html.match(/(\d+)\s*ep[ií]sodios?/i)

            const total = totalMatch ? parseInt(totalMatch[1]) : 0
            const pageCount = total > 0 ? Math.ceil(total / 10) : 1
            console.log(`[JK:findEpisodes] total: ${total}, pageCount: ${pageCount}`)

            const pageRequests = Array.from({ length: pageCount }, (_, i) =>
                fetch(`${this.baseUrl}/ajax/pagination_episodes/${seriesId}/${i + 1}/`, {
                    credentials: "include",
                    headers: { "X-Requested-With": "XMLHttpRequest", "Referer": url },
                }).then(r => {
                    console.log(`[JK:findEpisodes] ajax page ${i+1} status: ${r.status}`)
                    return r.ok ? r.json() : []
                }).catch(e => {
                    console.log(`[JK:findEpisodes] ajax page ${i+1} error: ${e}`)
                    return []
                })
            )

            const pages = await Promise.all(pageRequests)
            console.log(`[JK:findEpisodes] ajax pages raw: ${JSON.stringify(pages).slice(0, 500)}`)

            const episodes: EpisodeDetails[] = []
            const seen = new Set<number>()

            for (const page of pages) {
                if (!Array.isArray(page)) {
                    console.log(`[JK:findEpisodes] page is not array: ${typeof page}`)
                    continue
                }
                for (const ep of page) {
                    const number = parseInt(ep.number ?? ep.num ?? "0")
                    if (!number || seen.has(number)) continue
                    seen.add(number)
                    episodes.push({
                        id: `${id}/${number}`,
                        number,
                        url: `${this.baseUrl}/${id}/${number}/`,
                        title: ep.title ?? `Episodio ${number}`,
                    })
                }
            }

            console.log(`[JK:findEpisodes] episodes from ajax: ${episodes.length}`)
            if (episodes.length > 0) {
                return episodes.sort((a, b) => a.number - b.number)
            }
        }

        // Fallback: scrape episode links directly from the static HTML.
        console.log(`[JK:findEpisodes] falling back to HTML scraping`)
        const episodes: EpisodeDetails[] = []
        const seen = new Set<number>()

        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const epPattern = new RegExp(
            `href="(?:${this.baseUrl})?\\/(${escapedId}\\/(\\d+))\\/?"`,"g"
        )

        let match: RegExpExecArray | null
        while ((match = epPattern.exec(html)) !== null) {
            const epId = match[1]
            const number = parseInt(match[2])
            if (seen.has(number)) continue
            seen.add(number)
            episodes.push({
                id: epId,
                number,
                url: `${this.baseUrl}/${epId}/`,
                title: `Episodio ${number}`,
            })
        }

        if (episodes.length === 0) {
            const totalMatch =
                html.match(/Episodios:<\/span>[^<]*?(\d+)/) ??
                html.match(/data-episodes="(\d+)"/) ??
                html.match(/num-episodios[^>]*>\s*(\d+)/) ??
                html.match(/(\d+)\s*ep[ií]sodios?/i)

            const total = totalMatch ? parseInt(totalMatch[1]) : 0
            for (let i = 1; i <= total; i++) {
                episodes.push({
                    id: `${id}/${i}`,
                    number: i,
                    url: `${this.baseUrl}/${id}/${i}/`,
                    title: `Episodio ${i}`,
                })
            }
        }

        console.log(`[JK:findEpisodes] episodes from HTML fallback: ${episodes.length}`)
        return episodes.sort((a, b) => a.number - b.number)
    }

    /**
     * Maps a player embed URL to its canonical server name.
     * Unknown URLs fall back to "JK" (the site's native player).
     */
    private _serverName(url: string): string {
        if (url.includes("jkplayer") || url.includes("jkanime.net/jk")) return "JK"
        if (url.includes("desu.gg"))      return "Desu"
        if (url.includes("ok.ru"))        return "Okru"
        if (url.includes("yourupload"))   return "YourUpload"
        if (url.includes("streamwish"))   return "StreamWish"
        if (url.includes("doodstream") || url.includes("d0000d")) return "DoodStream"
        if (url.includes("filemoon"))     return "FileMoon"
        if (url.includes("voe.sx"))       return "Voe"
        return "JK"
    }

    /**
     * Extracts all player iframe/embed URLs from an episode page's HTML,
     * keyed by server name. Only the first URL per server is kept.
     *
     * Two passes are attempted:
     *  1. JS object literals — `"url":"https://..."` or `"src":"https://..."` —
     *     which is how JKAnime typically inlines player config.
     *  2. Plain `<iframe src="...">` tags as a fallback for older page layouts.
     */
    private _extractPlayerUrls(html: string): Record<string, string> {
        const map: Record<string, string> = {}

        const jsPattern = /["'](?:url|src)["']\s*:\s*["'](https?:\/\/[^"'\s]+)["']/g
        for (const [, url] of html.matchAll(jsPattern)) {
            const name = this._serverName(url)
            if (!(name in map)) map[name] = url
        }

        if (Object.keys(map).length === 0) {
            for (const [, url] of html.matchAll(/<iframe[^>]+src="(https?:\/\/[^"]+)"/g)) {
                const name = this._serverName(url)
                if (!(name in map)) map[name] = url
            }
        }

        return map
    }

    /**
     * Fetches a player embed page and extracts the direct stream URL.
     * Checks for Zilla Networks HLS streams first, then generic .m3u8, then .mp4.
     * Returns null if no recognisable stream URL is found.
     */
    private async _resolveStream(playerUrl: string): Promise<VideoSource | null> {
        const res = await fetch(playerUrl, {
            credentials: "include",
            headers: { "Referer": this.baseUrl + "/" },
        })

        if (!res.ok) return null

        const html = await res.text()

        // Zilla Networks CDN — used by JKAnime's own player.
        const zillaMatch = html.match(/["'`](https?:\/\/player\.zilla-networks\.com\/[^"'`\s]+)[`'"]/)
        if (zillaMatch) return { url: zillaMatch[1], type: "m3u8", quality: "default", subtitles: [] }

        const m3u8Match = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)[`'"]/)
        if (m3u8Match) return { url: m3u8Match[1], type: "m3u8", quality: "default", subtitles: [] }

        const mp4Match = html.match(/["'`](https?:\/\/[^"'`\s]+\.mp4[^"'`\s]*)[`'"]/)
        if (mp4Match) return { url: mp4Match[1], type: "mp4", quality: "default", subtitles: [] }

        return null
    }

    /**
     * Resolves the video source for a specific episode + server combination.
     * Falls back to the JK server, then to whatever is available, if the
     * requested server is not found on the page.
     */
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        console.log(`[JK:findEpisodeServer] episode.url: ${episode.url}, server: ${server}`)

        const res = await fetch(episode.url, { credentials: "include" })
        if (!res.ok) {
            console.log(`[JK:findEpisodeServer] episode page fetch failed: ${res.status}`)
            return { server, headers: {}, videoSources: [] }
        }

        const html = await res.text()
        console.log(`[JK:findEpisodeServer] episode html length: ${html.length}`)

        const playerMap = this._extractPlayerUrls(html)
        console.log(`[JK:findEpisodeServer] playerMap keys: ${JSON.stringify(Object.keys(playerMap))}`)

        if (Object.keys(playerMap).length === 0) {
            console.log(`[JK:findEpisodeServer] no players found in html`)
            return { server, headers: {}, videoSources: [] }
        }

        // Prefer the requested server; fall back to JK, then to the first available.
        const playerUrl = playerMap[server] ?? playerMap["JK"] ?? Object.values(playerMap)[0]
        console.log(`[JK:findEpisodeServer] selected playerUrl: ${playerUrl}`)

        const source = await this._resolveStream(playerUrl)
        console.log(`[JK:findEpisodeServer] resolved source: ${source ? source.url : "null"}`)

        return {
            server,
            headers: {
                "Referer": "https://jkanime.net/",
                "Origin": "https://jkanime.net",
            },
            videoSources: source ? [source] : [],
        }
    }
}
