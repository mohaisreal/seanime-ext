/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

type AnimeListEntry = $app.AL_AnimeCollection_MediaListCollection_Lists_Entries;

interface ResolvedAnimeEntry {
  progress: number;
  score?: number;
  status?: $app.AL_MediaListStatus;
  startedAt?: $app.AL_FuzzyDateInput;
  completedAt?: $app.AL_FuzzyDateInput;
  totalEpisodes: number;
  exists: boolean;
}

const BUTTON_STYLE: Record<string, string> = {
  minWidth: "40px",
  width: "40px",
  height: "40px",
  padding: "0",
  paddingInlineStart: "0",
  paddingInlineEnd: "0",
  fontWeight: "800",
  letterSpacing: "-0.04em",
};

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCollectionEntry(mediaId: number): AnimeListEntry | undefined {
  const collection = $anilist.getAnimeCollection(true);

  for (const list of collection?.MediaListCollection?.lists || []) {
    for (const entry of list?.entries || []) {
      if (entry?.media?.id === mediaId) return entry;
    }
  }

  return undefined;
}

function clampProgress(progress: number, totalEpisodes: number): number {
  if (totalEpisodes <= 0) return progress;
  return Math.min(progress, totalEpisodes);
}

function parseDateToFuzzy(value?: string): $app.AL_FuzzyDateInput | undefined {
  if (!value || typeof value !== "string") return undefined;

  const [year, month, day] = value.split("-").map((part) => asNumber(part, 0));
  if (!year) return undefined;

  return {
    year,
    month: month || undefined,
    day: day || undefined,
  };
}

function todayFuzzyDate(): $app.AL_FuzzyDateInput {
  const now = new Date();

  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

function wait(ctx: any, ms: number): Promise<void> {
  return new Promise((resolve) => ctx.setTimeout(resolve, ms));
}

function init() {
  $ui.register((ctx) => {
    let isProcessing = false;

    const button = ctx.action.newAnimePageButton({
      label: "+1",
      intent: "gray-subtle",
      style: BUTTON_STYLE,
      tooltipText: "Sumar +1 episodio visto",
    });

    button.mount();

    async function resolveEntry(mediaId: number): Promise<ResolvedAnimeEntry> {
      try {
        const entry = await ctx.anime.getAnimeEntry(mediaId);
        if (entry?.listData) {
          return {
            progress: asNumber(entry.listData.progress, 0),
            score: entry.listData.score,
            status: entry.listData.status,
            startedAt: parseDateToFuzzy(entry.listData.startedAt),
            completedAt: parseDateToFuzzy(entry.listData.completedAt),
            totalEpisodes: asNumber(entry.media?.episodes, 0),
            exists: true,
          };
        }
      } catch (_) {
        // Fall back to the AniList collection cache below.
      }

      const collectionEntry = getCollectionEntry(mediaId);
      if (!collectionEntry) {
        return {
          progress: 0,
          status: undefined,
          totalEpisodes: 0,
          exists: false,
        };
      }

      return {
        progress: asNumber(collectionEntry.progress, 0),
        score: collectionEntry.score,
        status: collectionEntry.status,
        startedAt: collectionEntry.startedAt,
        completedAt: collectionEntry.completedAt,
        totalEpisodes: asNumber(collectionEntry.media?.episodes, 0),
        exists: true,
      };
    }

    async function resetButton() {
      await wait(ctx, 900);
      button.setLabel("+1");
      button.setIntent("gray-subtle");
      button.setTooltipText("Sumar +1 episodio visto");
      button.setStyle(BUTTON_STYLE);
    }

    button.onClick(async (event) => {
      if (isProcessing) return;

      const media = event?.media;
      const mediaId = media?.id;

      if (!mediaId) {
        ctx.toast.error("No se pudo identificar el anime");
        return;
      }

      isProcessing = true;
      button.setLoading(true);
      button.setDisabled(true);
      button.setTooltipText("Actualizando progreso...");

      let shouldResetButton = false;

      try {
        const entry = await resolveEntry(mediaId);

        if (!entry.exists) {
          shouldResetButton = true;
          button.setLabel("!");
          button.setIntent("warning");
          ctx.toast.warning("Este anime no está en tu lista de AniList");
          return;
        }

        const totalEpisodes = asNumber(media?.episodes, 0) || entry.totalEpisodes;

        if (totalEpisodes > 0 && entry.progress >= totalEpisodes) {
          shouldResetButton = true;
          button.setLabel("✓");
          button.setIntent("success");
          ctx.toast.info("Este anime ya está marcado con todos sus episodios vistos");
          return;
        }

        const nextProgress = clampProgress(entry.progress + 1, totalEpisodes);
        const today = todayFuzzyDate();
        let nextStatus = entry.status;
        let startedAt = entry.startedAt;
        let completedAt = entry.completedAt;

        if (entry.status === "PLANNING") {
          nextStatus = "CURRENT";
          startedAt = today;
        }

        if (totalEpisodes > 0 && nextProgress >= totalEpisodes) {
          nextStatus = "COMPLETED";
          completedAt = today;
          if (!startedAt) startedAt = today;
        }

        $anilist.updateEntry(mediaId, nextStatus, entry.score, nextProgress, startedAt, completedAt);
        await wait(ctx, 500);
        $anilist.refreshAnimeCollection();

        button.setLabel("✓");
        button.setIntent("success");
        button.setTooltipText(`Progreso actualizado: ${nextProgress}${totalEpisodes > 0 ? `/${totalEpisodes}` : ""}`);
        ctx.toast.success(`+1 episodio visto (${nextProgress}${totalEpisodes > 0 ? `/${totalEpisodes}` : ""})`);
        shouldResetButton = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        shouldResetButton = true;
        button.setLabel("!");
        button.setIntent("alert");
        ctx.toast.error(`No se pudo actualizar AniList: ${message}`);
      } finally {
        isProcessing = false;
        button.setLoading(false);
        button.setDisabled(false);
        if (shouldResetButton) await resetButton();
      }
    });
  });
}
