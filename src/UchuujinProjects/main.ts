/// <reference path="./manga-provider.d.ts" />

interface SerieSearchResponse {
  series: {
    all: {
      post_image: string;
      post_title: string;
      post_link: string;
    }[];
  }[];
}

class Provider {
  private webUrl = "https://uchuujinmangas.com";

  getSettings(): Settings {
    return {
      supportsMultiLanguage: false,
      supportsMultiScanlator: false,
    };
  }

  async search(opts: QueryOptions): Promise<SearchResult[]> {
    const formData = new FormData();
    formData.append("action", "ts_ac_do_search");
    formData.append("ts_ac_query", opts.query);
    const res = await fetch(`${this.webUrl}/wp-admin/admin-ajax.php`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) return [];

    const data: SerieSearchResponse = await res.json();

    const series = data.series[0].all;

    return series.map((item) => ({
      id: item.post_link.split(this.webUrl)[1],
      title: item.post_title,
      image: item.post_image,
    }));
  }

  async findChapters(mangaId: string): Promise<ChapterDetails[]> {
    const res = await fetch(`${this.webUrl}${mangaId}`);

    if (!res.ok) return [];

    const html = await res.text();

    // Regex para capturar cada <li> completo
    const liRegex =
      /<li data-num="(\d+(?:\.\d+)?)"[\s\S]*?href="([^"]+)"[\s\S]*?<i>\s*-\s*([^<]+)<\/i>/g;
    const chapters: ChapterDetails[] = [];
    let match;
    while ((match = liRegex.exec(html)) !== null) {
      chapters.push({
        id: match[2].split(this.webUrl)[1],
        url: match[2],
        title: `Capítulo ${match[1]}${match[3] && !match[3].includes(match[1]) ? " - " + match[3] : ""}`,
        chapter: match[1],
        index: 0,
      });
    }

    // El índice es la posición de lectura; el número puede contener decimales.
    return chapters.reverse().map((chapter, index) => ({ ...chapter, index }));
  }

  async findChapterPages(chapterId: string): Promise<ChapterPage[]> {
    const res = await fetch(`${this.webUrl}${chapterId}`);

    if (!res.ok) return [];

    const html = await res.text();
    const sourcesRegex = /"sources":\s*(\[[\s\S]*?\})\s*\]/;

    const match = html.match(sourcesRegex);

    if (!match || !match[1]) return [];

    try {
      // Parsear el JSON capturado
      const sourcesJson = match[1] + "]";
      const sources: { source: string; images: string[] }[] =
        JSON.parse(sourcesJson);

      return sources[0].images.map((url, index) => ({
        index,
        url,
        headers: {
          Referer: `${this.webUrl}${chapterId}`,
        },
      }));
    } catch (error) {
      return [];
    }
  }
}
