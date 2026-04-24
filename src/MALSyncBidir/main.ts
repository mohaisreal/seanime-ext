/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

type MediaKind = "ANIME" | "MANGA";
type SyncMode = "ANI_TO_MAL" | "MAL_TO_ANI" | "BIDIRECTIONAL";

type MalAnimeStatus = "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";
type MalMangaStatus = "reading" | "completed" | "on_hold" | "dropped" | "plan_to_read";
type MalStatus = MalAnimeStatus | MalMangaStatus;

interface LogEntry {
  at: string;
  type: "info" | "success" | "warn" | "error";
  message: string;
}

interface SyncSettings {
  mode: SyncMode;
  liveSync: boolean;
  includeAnime: boolean;
  includeManga: boolean;
  syncDeletions: boolean;
  pollMalEnabled: boolean;
  pollEveryMinutes: number;
}

interface MalTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface AniCoreEntry {
  kind: MediaKind;
  mediaId: number;
  malId: number;
  status?: $app.AL_MediaListStatus;
  score: number;
  progress: number;
  repeat: number;
  startedAt?: $app.AL_FuzzyDateInput;
  completedAt?: $app.AL_FuzzyDateInput;
}

interface MalCoreEntry {
  kind: MediaKind;
  malId: number;
  status?: MalStatus;
  score: number;
  progress: number;
  repeat: number;
  startedAt?: string;
  completedAt?: string;
}

interface AniPatch {
  status?: $app.AL_MediaListStatus;
  scoreRaw?: number;
  progress?: number;
  repeat?: number;
  startedAt?: $app.AL_FuzzyDateInput;
  completedAt?: $app.AL_FuzzyDateInput;
}

interface MalAnimeListStatusPayload {
  status?: MalAnimeStatus;
  score?: number;
  num_watched_episodes?: number;
  is_rewatching?: boolean;
  num_times_rewatched?: number;
  start_date?: string;
  finish_date?: string;
}

interface MalMangaListStatusPayload {
  status?: MalMangaStatus;
  score?: number;
  num_chapters_read?: number;
  is_rereading?: boolean;
  num_times_reread?: number;
  start_date?: string;
  finish_date?: string;
}

interface MalListItem<TStatus = any> {
  node?: {
    id?: number;
    title?: string;
  };
  list_status?: TStatus;
}

interface MalListPage<TStatus = any> {
  data?: Array<MalListItem<TStatus>>;
  paging?: {
    next?: string;
  };
}

function nowHHMMSS() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

function asNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(min: number, max: number, value: number) {
  return Math.max(min, Math.min(max, value));
}

function parseDateToFuzzy(value?: string): $app.AL_FuzzyDateInput | undefined {
  if (!value || typeof value !== "string") return undefined;
  const chunks = value.split("-");
  if (!chunks.length) return undefined;
  const year = asNumber(chunks[0], 0);
  const month = asNumber(chunks[1], 0);
  const day = asNumber(chunks[2], 0);
  if (!year) return undefined;
  return {
    year,
    month: month || undefined,
    day: day || undefined,
  };
}

function fuzzyToDateString(value?: $app.AL_FuzzyDateInput): string | undefined {
  if (!value || !value.year) return undefined;
  const month = String(value.month ?? 1).padStart(2, "0");
  const day = String(value.day ?? 1).padStart(2, "0");
  return `${value.year}-${month}-${day}`;
}

function sameDateFuzzy(a?: $app.AL_FuzzyDateInput, b?: $app.AL_FuzzyDateInput) {
  return (a?.year ?? 0) === (b?.year ?? 0) &&
    (a?.month ?? 0) === (b?.month ?? 0) &&
    (a?.day ?? 0) === (b?.day ?? 0);
}

function encodeForm(body: Record<string, string | number | boolean | undefined>) {
  const chunks: string[] = [];
  for (const key in body) {
    const val = body[key];
    if (val === undefined || val === null) continue;
    chunks.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
  }
  return chunks.join("&");
}

function safeJson(value: any) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return "[unserializable]";
  }
}

function normalizeAniStatusToMal(kind: MediaKind, status?: $app.AL_MediaListStatus): MalStatus | undefined {
  if (!status) return undefined;

  if (kind === "ANIME") {
    const map: Record<string, MalAnimeStatus> = {
      COMPLETED: "completed",
      CURRENT: "watching",
      DROPPED: "dropped",
      PAUSED: "on_hold",
      PLANNING: "plan_to_watch",
      REPEATING: "watching",
    };
    return map[status];
  }

  const mangaMap: Record<string, MalMangaStatus> = {
    COMPLETED: "completed",
    CURRENT: "reading",
    DROPPED: "dropped",
    PAUSED: "on_hold",
    PLANNING: "plan_to_read",
    REPEATING: "reading",
  };
  return mangaMap[status];
}

function normalizeMalStatusToAni(kind: MediaKind, status?: string): $app.AL_MediaListStatus | undefined {
  if (!status) return undefined;

  if (kind === "ANIME") {
    const map: Record<string, $app.AL_MediaListStatus> = {
      completed: "COMPLETED",
      watching: "CURRENT",
      dropped: "DROPPED",
      on_hold: "PAUSED",
      plan_to_watch: "PLANNING",
    };
    return map[status];
  }

  const mangaMap: Record<string, $app.AL_MediaListStatus> = {
    completed: "COMPLETED",
    reading: "CURRENT",
    dropped: "DROPPED",
    on_hold: "PAUSED",
    plan_to_read: "PLANNING",
  };
  return mangaMap[status];
}

function normalizeAniScoreToMal(scoreRaw: number) {
  if (!scoreRaw) return 0;
  if (scoreRaw > 10) return clamp(0, 10, Math.round(scoreRaw / 10));
  return clamp(0, 10, Math.round(scoreRaw));
}

function coreFingerprint(entry: {
  status?: any;
  score?: number;
  progress?: number;
  repeat?: number;
}) {
  return `${entry.status ?? "null"}|${entry.score ?? 0}|${entry.progress ?? 0}|${entry.repeat ?? 0}`;
}

function init() {
  $app.onPostUpdateEntry((e) => {
    if (e.mediaId) {
      $store.set("malsync_bidir.signal.post_update", {
        mediaId: e.mediaId,
        at: Date.now(),
      });
    }
    e.next();
  });

  $app.onPostUpdateEntryProgress((e) => {
    if (e.mediaId) {
      $store.set("malsync_bidir.signal.post_update", {
        mediaId: e.mediaId,
        at: Date.now(),
      });
    }
    e.next();
  });

  $app.onPostUpdateEntryRepeat((e) => {
    if (e.mediaId) {
      $store.set("malsync_bidir.signal.post_update", {
        mediaId: e.mediaId,
        at: Date.now(),
      });
    }
    e.next();
  });

  $ui.register((ctx) => {
    const POST_UPDATE_SIGNAL_KEY = "malsync_bidir.signal.post_update";
    const MAL_API_BASE = "https://api.myanimelist.net/v2";
    const MAL_TOKEN_URI = "https://myanimelist.net/v1/oauth2/token";
    const MAL_AUTH_URI = "https://myanimelist.net/v1/oauth2/authorize";
    const ICON_URL = "https://cdn.myanimelist.net/images/favicon.ico";
    const REDIRECT_URI = "http://localhost";
    const POLL_CRON_ID = "malsync-bidir-poll";
    const LOOP_WINDOW_MS = 90 * 1000;

    const STORAGE = {
      CLIENT_ID: "malsync_bidir.clientId",
      CLIENT_SECRET: "malsync_bidir.clientSecret",
      PKCE_VERIFIER: "malsync_bidir.pkceVerifier",
      ACCESS_TOKEN: "malsync_bidir.accessToken",
      REFRESH_TOKEN: "malsync_bidir.refreshToken",
      EXPIRES_AT: "malsync_bidir.expiresAt",
      MODE: "malsync_bidir.mode",
      LIVE_SYNC: "malsync_bidir.liveSync",
      INCLUDE_ANIME: "malsync_bidir.includeAnime",
      INCLUDE_MANGA: "malsync_bidir.includeManga",
      SYNC_DELETIONS: "malsync_bidir.syncDeletions",
      POLL_MAL_ENABLED: "malsync_bidir.pollMalEnabled",
      POLL_EVERY_MINUTES: "malsync_bidir.pollEveryMinutes",
    };

    const DEFAULT_SETTINGS: SyncSettings = {
      mode: "BIDIRECTIONAL",
      liveSync: true,
      includeAnime: true,
      includeManga: true,
      syncDeletions: false,
      pollMalEnabled: true,
      pollEveryMinutes: 15,
    };

    function nowHHMMSS() {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    }

    function asNumber(v: any, fallback = 0) {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }

    function clamp(min: number, max: number, value: number) {
      return Math.max(min, Math.min(max, value));
    }

    function parseDateToFuzzy(value?: string): $app.AL_FuzzyDateInput | undefined {
      if (!value || typeof value !== "string") return undefined;
      const chunks = value.split("-");
      if (!chunks.length) return undefined;
      const year = asNumber(chunks[0], 0);
      const month = asNumber(chunks[1], 0);
      const day = asNumber(chunks[2], 0);
      if (!year) return undefined;
      return {
        year,
        month: month || undefined,
        day: day || undefined,
      };
    }

    function fuzzyToDateString(value?: $app.AL_FuzzyDateInput): string | undefined {
      if (!value || !value.year) return undefined;
      const month = String(value.month ?? 1).padStart(2, "0");
      const day = String(value.day ?? 1).padStart(2, "0");
      return `${value.year}-${month}-${day}`;
    }

    function sameDateFuzzy(a?: $app.AL_FuzzyDateInput, b?: $app.AL_FuzzyDateInput) {
      return (a?.year ?? 0) === (b?.year ?? 0) &&
        (a?.month ?? 0) === (b?.month ?? 0) &&
        (a?.day ?? 0) === (b?.day ?? 0);
    }

    function encodeForm(body: Record<string, string | number | boolean | undefined>) {
      const chunks: string[] = [];
      for (const key in body) {
        const val = body[key];
        if (val === undefined || val === null) continue;
        chunks.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
      }
      return chunks.join("&");
    }

    function safeJson(value: any) {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return "[unserializable]";
      }
    }

    function normalizeAniStatusToMal(kind: MediaKind, status?: $app.AL_MediaListStatus): MalStatus | undefined {
      if (!status) return undefined;

      if (kind === "ANIME") {
        const map: Record<string, MalAnimeStatus> = {
          COMPLETED: "completed",
          CURRENT: "watching",
          DROPPED: "dropped",
          PAUSED: "on_hold",
          PLANNING: "plan_to_watch",
          REPEATING: "watching",
        };
        return map[status];
      }

      const mangaMap: Record<string, MalMangaStatus> = {
        COMPLETED: "completed",
        CURRENT: "reading",
        DROPPED: "dropped",
        PAUSED: "on_hold",
        PLANNING: "plan_to_read",
        REPEATING: "reading",
      };
      return mangaMap[status];
    }

    function normalizeMalStatusToAni(kind: MediaKind, status?: string): $app.AL_MediaListStatus | undefined {
      if (!status) return undefined;

      if (kind === "ANIME") {
        const map: Record<string, $app.AL_MediaListStatus> = {
          completed: "COMPLETED",
          watching: "CURRENT",
          dropped: "DROPPED",
          on_hold: "PAUSED",
          plan_to_watch: "PLANNING",
        };
        return map[status];
      }

      const mangaMap: Record<string, $app.AL_MediaListStatus> = {
        completed: "COMPLETED",
        reading: "CURRENT",
        dropped: "DROPPED",
        on_hold: "PAUSED",
        plan_to_read: "PLANNING",
      };
      return mangaMap[status];
    }

    function normalizeAniScoreToMal(scoreRaw: number) {
      if (!scoreRaw) return 0;
      if (scoreRaw > 10) return clamp(0, 10, Math.round(scoreRaw / 10));
      return clamp(0, 10, Math.round(scoreRaw));
    }

    function coreFingerprint(entry: {
      status?: any;
      score?: number;
      progress?: number;
      repeat?: number;
    }) {
      return `${entry.status ?? "null"}|${entry.score ?? 0}|${entry.progress ?? 0}|${entry.repeat ?? 0}`;
    }

    const logs = ctx.state<LogEntry[]>([]);
    const statusText = ctx.state("Idle");
    const isSyncing = ctx.state(false);
    const lastRun = ctx.state<string>("Never");
    const settingsFeedback = ctx.state("");
    const authFeedback = ctx.state("");
    const isAuthenticated = ctx.state<boolean>(Boolean($storage.get(STORAGE.ACCESS_TOKEN)));
    const recentSyncMarks = ctx.state<Record<string, number>>({});

    const clientIdRef = ctx.fieldRef<string>($storage.get(STORAGE.CLIENT_ID) || "");
    const clientSecretRef = ctx.fieldRef<string>($storage.get(STORAGE.CLIENT_SECRET) || "");
    const authCodeRef = ctx.fieldRef<string>("");
    const modeRef = ctx.fieldRef<SyncMode>(($storage.get(STORAGE.MODE) as SyncMode) || DEFAULT_SETTINGS.mode);
    const liveSyncRef = ctx.fieldRef<boolean>($storage.get(STORAGE.LIVE_SYNC) ?? DEFAULT_SETTINGS.liveSync);
    const includeAnimeRef = ctx.fieldRef<boolean>($storage.get(STORAGE.INCLUDE_ANIME) ?? DEFAULT_SETTINGS.includeAnime);
    const includeMangaRef = ctx.fieldRef<boolean>($storage.get(STORAGE.INCLUDE_MANGA) ?? DEFAULT_SETTINGS.includeManga);
    const syncDeletionsRef = ctx.fieldRef<boolean>($storage.get(STORAGE.SYNC_DELETIONS) ?? DEFAULT_SETTINGS.syncDeletions);
    const pollEnabledRef = ctx.fieldRef<boolean>($storage.get(STORAGE.POLL_MAL_ENABLED) ?? DEFAULT_SETTINGS.pollMalEnabled);
    const pollEveryMinutesRef = ctx.fieldRef<string>(String($storage.get(STORAGE.POLL_EVERY_MINUTES) ?? DEFAULT_SETTINGS.pollEveryMinutes));

    function addLog(message: string, type: LogEntry["type"] = "info") {
      logs.set((prev) => [{ at: nowHHMMSS(), type, message }, ...prev].slice(0, 250));
      statusText.set(message);
    }

    function loadSettings(): SyncSettings {
      return {
        mode: (($storage.get(STORAGE.MODE) as SyncMode) || DEFAULT_SETTINGS.mode),
        liveSync: $storage.get(STORAGE.LIVE_SYNC) ?? DEFAULT_SETTINGS.liveSync,
        includeAnime: $storage.get(STORAGE.INCLUDE_ANIME) ?? DEFAULT_SETTINGS.includeAnime,
        includeManga: $storage.get(STORAGE.INCLUDE_MANGA) ?? DEFAULT_SETTINGS.includeManga,
        syncDeletions: $storage.get(STORAGE.SYNC_DELETIONS) ?? DEFAULT_SETTINGS.syncDeletions,
        pollMalEnabled: $storage.get(STORAGE.POLL_MAL_ENABLED) ?? DEFAULT_SETTINGS.pollMalEnabled,
        pollEveryMinutes: asNumber($storage.get(STORAGE.POLL_EVERY_MINUTES), DEFAULT_SETTINGS.pollEveryMinutes),
      };
    }

    function saveSettingsFromRefs() {
      const pollEvery = clamp(5, 60, asNumber(pollEveryMinutesRef.current, DEFAULT_SETTINGS.pollEveryMinutes));
      $storage.set(STORAGE.MODE, modeRef.current);
      $storage.set(STORAGE.LIVE_SYNC, !!liveSyncRef.current);
      $storage.set(STORAGE.INCLUDE_ANIME, !!includeAnimeRef.current);
      $storage.set(STORAGE.INCLUDE_MANGA, !!includeMangaRef.current);
      $storage.set(STORAGE.SYNC_DELETIONS, !!syncDeletionsRef.current);
      $storage.set(STORAGE.POLL_MAL_ENABLED, !!pollEnabledRef.current);
      $storage.set(STORAGE.POLL_EVERY_MINUTES, pollEvery);
      pollEveryMinutesRef.setValue(String(pollEvery));
    }

    function getStoredTokens(): MalTokens {
      return {
        accessToken: $storage.get(STORAGE.ACCESS_TOKEN),
        refreshToken: $storage.get(STORAGE.REFRESH_TOKEN),
        expiresAt: $storage.get(STORAGE.EXPIRES_AT),
      };
    }

    function saveTokens(tokens: MalTokens) {
      $storage.set(STORAGE.ACCESS_TOKEN, tokens.accessToken || "");
      $storage.set(STORAGE.REFRESH_TOKEN, tokens.refreshToken || "");
      $storage.set(STORAGE.EXPIRES_AT, tokens.expiresAt || 0);
      isAuthenticated.set(Boolean(tokens.accessToken));
    }

    function generateCodeVerifier() {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
      let out = "";
      for (let i = 0; i < 128; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
      return out;
    }

    function buildAuthUrl() {
      const clientId = $storage.get(STORAGE.CLIENT_ID) || "";
      const verifier = $storage.get(STORAGE.PKCE_VERIFIER) || "";
      if (!clientId || !verifier) return "";

      return `${MAL_AUTH_URI}?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&code_challenge=${encodeURIComponent(verifier)}` +
        `&code_challenge_method=plain` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    }

    function markRecent(kind: MediaKind, malId: number, fingerprint: string) {
      const key = `${kind}:${malId}:${fingerprint}`;
      const now = Date.now();
      const curr = { ...recentSyncMarks.get() };
      curr[key] = now;

      for (const k in curr) {
        if (now - curr[k] > LOOP_WINDOW_MS * 2) delete curr[k];
      }
      recentSyncMarks.set(curr);
    }

    function isRecent(kind: MediaKind, malId: number, fingerprint: string) {
      const key = `${kind}:${malId}:${fingerprint}`;
      const ts = recentSyncMarks.get()[key];
      return !!ts && (Date.now() - ts) < LOOP_WINDOW_MS;
    }

    const tokenManager = {
      async exchangeCode(authCodeOrUrl: string) {
        const clientId = $storage.get(STORAGE.CLIENT_ID) || "";
        const clientSecret = $storage.get(STORAGE.CLIENT_SECRET) || "";
        const verifier = $storage.get(STORAGE.PKCE_VERIFIER) || "";
        if (!clientId || !verifier) throw new Error("Falta client_id o code_verifier");

        let code = authCodeOrUrl.trim();
        if (code.includes("code=")) {
          const match = code.match(/[?&]code=([^&]+)/);
          if (match?.[1]) code = decodeURIComponent(match[1]);
        }
        if (!code) throw new Error("No se encontró el auth code");

        const body = encodeForm({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret || undefined,
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
        });

        const res = await ctx.fetch(MAL_TOKEN_URI, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });

        if (!res.ok) throw new Error(`Token exchange falló (${res.status})`);
        const data = await res.json();
        saveTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + (asNumber(data.expires_in, 3600) * 1000),
        });
      },

      async refreshIfNeeded() {
        const current = getStoredTokens();
        if (!current.accessToken || !current.refreshToken) throw new Error("No hay tokens MAL guardados");
        const expiresAt = current.expiresAt || 0;
        if (Date.now() < (expiresAt - 30_000)) return current.accessToken;

        const clientId = $storage.get(STORAGE.CLIENT_ID) || "";
        const clientSecret = $storage.get(STORAGE.CLIENT_SECRET) || "";
        if (!clientId) throw new Error("Falta client_id");

        const body = encodeForm({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: clientId,
          client_secret: clientSecret || undefined,
        });

        const res = await ctx.fetch(MAL_TOKEN_URI, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });

        if (!res.ok) throw new Error(`Refresh token falló (${res.status})`);
        const data = await res.json();
        saveTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token || current.refreshToken,
          expiresAt: Date.now() + (asNumber(data.expires_in, 3600) * 1000),
        });
        return data.access_token as string;
      },

      async withAuthHeaders() {
        const accessToken = await tokenManager.refreshIfNeeded();
        return {
          Authorization: `Bearer ${accessToken}`,
        };
      },
    };

    const malClient = {
      async fetchPaged<T>(url: string): Promise<T[]> {
        const out: T[] = [];
        let nextUrl: string | undefined = url;
        let guard = 0;

        while (nextUrl && guard < 10_000) {
          guard += 1;
          const res = await ctx.fetch(nextUrl, { headers: await tokenManager.withAuthHeaders() });
          if (!res.ok) throw new Error(`MAL list fetch falló (${res.status})`);

          const page = await res.json() as MalListPage;
          const data = page?.data || [];
          for (const item of data) out.push(item as unknown as T);
          nextUrl = page?.paging?.next;
        }
        return out;
      },

      async fetchAnimeList() {
        const url = `${MAL_API_BASE}/users/@me/animelist?fields=list_status&limit=1000`;
        return await malClient.fetchPaged<MalListItem<MalAnimeListStatusPayload>>(url);
      },

      async fetchMangaList() {
        const url = `${MAL_API_BASE}/users/@me/mangalist?fields=list_status&limit=1000`;
        return await malClient.fetchPaged<MalListItem<MalMangaListStatusPayload>>(url);
      },

      async getAnimeStatus(malId: number): Promise<MalCoreEntry | undefined> {
        const res = await ctx.fetch(
          `${MAL_API_BASE}/anime/${malId}?fields=my_list_status{status,score,num_watched_episodes,is_rewatching,num_times_rewatched,start_date,finish_date}`,
          { headers: await tokenManager.withAuthHeaders() },
        );
        if (!res.ok) {
          if (res.status === 404) return undefined;
          throw new Error(`No pude leer estado anime MAL (${res.status})`);
        }
        const data = await res.json();
        return toMalCoreFromAnimePayload(malId, data?.my_list_status);
      },

      async getMangaStatus(malId: number): Promise<MalCoreEntry | undefined> {
        const res = await ctx.fetch(
          `${MAL_API_BASE}/manga/${malId}?fields=my_list_status{status,score,num_chapters_read,is_rereading,num_times_reread,start_date,finish_date}`,
          { headers: await tokenManager.withAuthHeaders() },
        );
        if (!res.ok) {
          if (res.status === 404) return undefined;
          throw new Error(`No pude leer estado manga MAL (${res.status})`);
        }
        const data = await res.json();
        return toMalCoreFromMangaPayload(malId, data?.my_list_status);
      },

      async upsertAnime(target: MalCoreEntry) {
        const body = encodeForm({
          status: target.status as MalAnimeStatus,
          score: clamp(0, 10, target.score),
          num_watched_episodes: Math.max(0, target.progress),
          is_rewatching: target.repeat > 0,
          num_times_rewatched: Math.max(0, target.repeat),
          start_date: target.startedAt,
          finish_date: target.completedAt,
        });

        const res = await ctx.fetch(`${MAL_API_BASE}/anime/${target.malId}/my_list_status`, {
          method: "PUT",
          headers: {
            ...(await tokenManager.withAuthHeaders()),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
        if (!res.ok) throw new Error(`No pude upsert anime MAL (${res.status})`);
      },

      async upsertManga(target: MalCoreEntry) {
        const body = encodeForm({
          status: target.status as MalMangaStatus,
          score: clamp(0, 10, target.score),
          num_chapters_read: Math.max(0, target.progress),
          is_rereading: target.repeat > 0,
          num_times_reread: Math.max(0, target.repeat),
          start_date: target.startedAt,
          finish_date: target.completedAt,
        });

        const res = await ctx.fetch(`${MAL_API_BASE}/manga/${target.malId}/my_list_status`, {
          method: "PUT",
          headers: {
            ...(await tokenManager.withAuthHeaders()),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });
        if (!res.ok) throw new Error(`No pude upsert manga MAL (${res.status})`);
      },

      async remove(kind: MediaKind, malId: number) {
        const endpoint = kind === "ANIME" ? "anime" : "manga";
        const res = await ctx.fetch(`${MAL_API_BASE}/${endpoint}/${malId}/my_list_status`, {
          method: "DELETE",
          headers: await tokenManager.withAuthHeaders(),
        });
        if (!res.ok && res.status !== 404) throw new Error(`No pude borrar entrada MAL (${res.status})`);
      },
    };

    const aniListAdapter = {
      getCollectionMap(kind: MediaKind) {
        const byMalId = new Map<number, AniCoreEntry>();
        if (kind === "ANIME") {
          const collection = $anilist.getAnimeCollection(true);
          for (const list of collection?.MediaListCollection?.lists || []) {
            for (const entry of list?.entries || []) {
              const malId = entry?.media?.idMal;
              const mediaId = entry?.media?.id;
              if (!malId || !mediaId) continue;
              byMalId.set(malId, {
                kind,
                mediaId,
                malId,
                status: entry.status,
                score: asNumber(entry.score, 0),
                progress: asNumber(entry.progress, 0),
                repeat: asNumber(entry.repeat, 0),
                startedAt: entry.startedAt,
                completedAt: entry.completedAt,
              });
            }
          }
          return byMalId;
        }

        const collection = $anilist.getMangaCollection(true);
        for (const list of collection?.MediaListCollection?.lists || []) {
          for (const entry of list?.entries || []) {
            const malId = entry?.media?.idMal;
            const mediaId = entry?.media?.id;
            if (!malId || !mediaId) continue;
            byMalId.set(malId, {
              kind,
              mediaId,
              malId,
              status: entry.status,
              score: asNumber(entry.score, 0),
              progress: asNumber(entry.progress, 0),
              repeat: asNumber(entry.repeat, 0),
              startedAt: entry.startedAt,
              completedAt: entry.completedAt,
            });
          }
        }
        return byMalId;
      },

      resolveAniMediaIdByMalId(kind: MediaKind, malId: number): number | undefined {
        const token = $database.anilist.getToken();
        const body = {
          query: `
            query($idMal: Int, $type: MediaType) {
              Media(idMal: $idMal, type: $type) {
                id
              }
            }
          `,
          variables: {
            idMal: malId,
            type: kind,
          },
        };

        const data = $anilist.customQuery<any>(body, token);
        const id = data?.data?.Media?.id ?? data?.Media?.id;
        if (!id) return undefined;
        return Number(id);
      },

      upsertEntry(mediaId: number, patch: AniPatch) {
        $anilist.updateEntry(
          mediaId,
          patch.status,
          patch.scoreRaw,
          patch.progress,
          patch.startedAt,
          patch.completedAt,
        );

        if ((patch.repeat ?? 0) > 0) {
          $anilist.updateEntryRepeat(mediaId, patch.repeat!);
        }
      },

      deleteEntry(mediaId: number) {
        $anilist.deleteEntry(mediaId);
      },

      refresh(kind: MediaKind) {
        if (kind === "ANIME") $anilist.refreshAnimeCollection();
        else $anilist.refreshMangaCollection();
      },
    };

    function toMalCoreFromAnimePayload(malId: number, listStatus?: MalAnimeListStatusPayload): MalCoreEntry {
      return {
        kind: "ANIME",
        malId,
        status: listStatus?.status,
        score: asNumber(listStatus?.score, 0),
        progress: asNumber(listStatus?.num_watched_episodes, 0),
        repeat: asNumber(listStatus?.num_times_rewatched, 0),
        startedAt: listStatus?.start_date,
        completedAt: listStatus?.finish_date,
      };
    }

    function toMalCoreFromMangaPayload(malId: number, listStatus?: MalMangaListStatusPayload): MalCoreEntry {
      return {
        kind: "MANGA",
        malId,
        status: listStatus?.status,
        score: asNumber(listStatus?.score, 0),
        progress: asNumber(listStatus?.num_chapters_read, 0),
        repeat: asNumber(listStatus?.num_times_reread, 0),
        startedAt: listStatus?.start_date,
        completedAt: listStatus?.finish_date,
      };
    }

    function toMalCoreFromAniCore(ani: AniCoreEntry): MalCoreEntry {
      return {
        kind: ani.kind,
        malId: ani.malId,
        status: normalizeAniStatusToMal(ani.kind, ani.status),
        score: normalizeAniScoreToMal(ani.score),
        progress: Math.max(0, ani.progress),
        repeat: Math.max(0, ani.repeat),
        startedAt: fuzzyToDateString(ani.startedAt),
        completedAt: fuzzyToDateString(ani.completedAt),
      };
    }

    function toAniPatchFromMalCore(mal: MalCoreEntry): AniPatch {
      return {
        status: normalizeMalStatusToAni(mal.kind, mal.status),
        scoreRaw: clamp(0, 10, mal.score),
        progress: Math.max(0, mal.progress),
        repeat: Math.max(0, mal.repeat),
        startedAt: parseDateToFuzzy(mal.startedAt),
        completedAt: parseDateToFuzzy(mal.completedAt),
      };
    }

    function needsMalUpdate(current: MalCoreEntry | undefined, target: MalCoreEntry) {
      if (!current) return true;
      return current.status !== target.status ||
        current.score !== target.score ||
        current.progress !== target.progress ||
        current.repeat !== target.repeat ||
        (current.startedAt || "") !== (target.startedAt || "") ||
        (current.completedAt || "") !== (target.completedAt || "");
    }

    function needsAniUpdate(current: AniCoreEntry | undefined, target: AniPatch) {
      if (!current) return true;
      return current.status !== target.status ||
        asNumber(current.score, 0) !== asNumber(target.scoreRaw, 0) ||
        asNumber(current.progress, 0) !== asNumber(target.progress, 0) ||
        asNumber(current.repeat, 0) !== asNumber(target.repeat, 0) ||
        !sameDateFuzzy(current.startedAt, target.startedAt) ||
        !sameDateFuzzy(current.completedAt, target.completedAt);
    }

    function getAniCoreFromCtxEntry(kind: MediaKind, mediaId: number): Promise<AniCoreEntry | undefined> {
      if (kind === "ANIME") {
        return ctx.anime.getAnimeEntry(mediaId)
          .then((entry) => {
            const media = $anilist.getAnime(mediaId);
            const malId = media?.idMal;
            if (!malId) return undefined;
            return {
              kind,
              mediaId,
              malId,
              status: entry?.listData?.status,
              score: asNumber(entry?.listData?.score, 0),
              progress: asNumber(entry?.listData?.progress, 0),
              repeat: asNumber(entry?.listData?.repeat, 0),
              startedAt: parseDateToFuzzy(entry?.listData?.startedAt),
              completedAt: parseDateToFuzzy(entry?.listData?.completedAt),
            } as AniCoreEntry;
          })
          .catch(() => undefined);
      }

      return ctx.manga.getMangaEntry(mediaId)
        .then((entry) => {
          const media = $anilist.getManga(mediaId);
          const malId = media?.idMal;
          if (!malId) return undefined;
          return {
            kind,
            mediaId,
            malId,
            status: entry?.listData?.status,
            score: asNumber(entry?.listData?.score, 0),
            progress: asNumber(entry?.listData?.progress, 0),
            repeat: asNumber(entry?.listData?.repeat, 0),
            startedAt: parseDateToFuzzy(entry?.listData?.startedAt),
            completedAt: parseDateToFuzzy(entry?.listData?.completedAt),
          } as AniCoreEntry;
        })
        .catch(() => undefined);
    }

    async function syncSingleAniToMal(kind: MediaKind, mediaId: number) {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return;
      if (kind === "MANGA" && !settings.includeManga) return;

      const aniCore = await getAniCoreFromCtxEntry(kind, mediaId);
      if (!aniCore) return;

      const target = toMalCoreFromAniCore(aniCore);
      const fp = coreFingerprint(target);
      if (isRecent(kind, target.malId, fp)) return;

      let current: MalCoreEntry | undefined;
      if (kind === "ANIME") current = await malClient.getAnimeStatus(target.malId);
      else current = await malClient.getMangaStatus(target.malId);

      if (!needsMalUpdate(current, target)) return;

      if (kind === "ANIME") await malClient.upsertAnime(target);
      else await malClient.upsertManga(target);

      markRecent(kind, target.malId, fp);
      addLog(`Live sync ${kind} ${target.malId} -> MAL`, "success");
    }

    async function syncAniToMalBatch(kind: MediaKind) {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return;
      if (kind === "MANGA" && !settings.includeManga) return;

      const aniMap = aniListAdapter.getCollectionMap(kind);
      const malMap = new Map<number, MalCoreEntry>();

      if (kind === "ANIME") {
        const malItems = await malClient.fetchAnimeList();
        for (const item of malItems) {
          const malId = asNumber(item?.node?.id, 0);
          if (!malId) continue;
          malMap.set(malId, toMalCoreFromAnimePayload(malId, item.list_status));
        }
      } else {
        const malItems = await malClient.fetchMangaList();
        for (const item of malItems) {
          const malId = asNumber(item?.node?.id, 0);
          if (!malId) continue;
          malMap.set(malId, toMalCoreFromMangaPayload(malId, item.list_status));
        }
      }

      let changed = 0;
      for (const [malId, aniCore] of aniMap.entries()) {
        const target = toMalCoreFromAniCore(aniCore);
        const current = malMap.get(malId);
        if (!needsMalUpdate(current, target)) continue;

        if (kind === "ANIME") await malClient.upsertAnime(target);
        else await malClient.upsertManga(target);

        markRecent(kind, malId, coreFingerprint(target));
        changed += 1;
      }

      if (settings.syncDeletions) {
        for (const [malId] of malMap.entries()) {
          if (aniMap.has(malId)) continue;
          await malClient.remove(kind, malId);
          changed += 1;
        }
      }

      addLog(`Batch ANI->MAL ${kind}: ${changed} cambios`, "success");
    }

    async function syncMalToAniBatch(kind: MediaKind) {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return;
      if (kind === "MANGA" && !settings.includeManga) return;

      const aniMap = aniListAdapter.getCollectionMap(kind);
      const malMap = new Map<number, MalCoreEntry>();

      if (kind === "ANIME") {
        const items = await malClient.fetchAnimeList();
        for (const item of items) {
          const malId = asNumber(item?.node?.id, 0);
          if (!malId) continue;
          malMap.set(malId, toMalCoreFromAnimePayload(malId, item.list_status));
        }
      } else {
        const items = await malClient.fetchMangaList();
        for (const item of items) {
          const malId = asNumber(item?.node?.id, 0);
          if (!malId) continue;
          malMap.set(malId, toMalCoreFromMangaPayload(malId, item.list_status));
        }
      }

      let changed = 0;
      for (const [malId, malCore] of malMap.entries()) {
        let currentAni = aniMap.get(malId);
        let mediaId = currentAni?.mediaId;

        if (!mediaId) {
          mediaId = aniListAdapter.resolveAniMediaIdByMalId(kind, malId);
          if (!mediaId) continue;
        }

        const patch = toAniPatchFromMalCore(malCore);
        if (!needsAniUpdate(currentAni, patch)) continue;
        aniListAdapter.upsertEntry(mediaId, patch);

        markRecent(kind, malId, coreFingerprint({
          status: patch.status,
          score: patch.scoreRaw,
          progress: patch.progress,
          repeat: patch.repeat,
        }));

        changed += 1;
      }

      if (settings.syncDeletions) {
        for (const [malId, aniCore] of aniMap.entries()) {
          if (malMap.has(malId)) continue;
          aniListAdapter.deleteEntry(aniCore.mediaId);
          changed += 1;
        }
      }

      aniListAdapter.refresh(kind);
      addLog(`Batch MAL->ANI ${kind}: ${changed} cambios`, "success");
    }

    async function runSync(mode: SyncMode) {
      if (isSyncing.get()) return;
      isSyncing.set(true);

      try {
        statusText.set(`Sync ${mode} en progreso...`);
        await tokenManager.refreshIfNeeded();

        if (mode === "ANI_TO_MAL" || mode === "BIDIRECTIONAL") {
          await syncAniToMalBatch("ANIME");
          await syncAniToMalBatch("MANGA");
        }
        if (mode === "MAL_TO_ANI" || mode === "BIDIRECTIONAL") {
          await syncMalToAniBatch("ANIME");
          await syncMalToAniBatch("MANGA");
        }

        lastRun.set(new Date().toISOString());
        addLog(`Sync ${mode} finalizado`, "success");
      } catch (err) {
        addLog(`Sync error: ${(err as Error).message}`, "error");
      } finally {
        isSyncing.set(false);
      }
    }

    function inferKindByMediaId(mediaId: number): MediaKind | undefined {
      try {
        const anime = $anilist.getAnime(mediaId);
        if (anime?.id) return "ANIME";
      } catch (_) { /* noop */ }

      try {
        const manga = $anilist.getManga(mediaId);
        if (manga?.id) return "MANGA";
      } catch (_) { /* noop */ }

      return undefined;
    }

    async function handlePostUpdate(mediaId?: number) {
      const settings = loadSettings();
      if (!settings.liveSync) return;
      if (isSyncing.get()) return;
      if (!mediaId) return;

      try {
        await tokenManager.refreshIfNeeded();
        const kind = inferKindByMediaId(mediaId);
        if (!kind) return;
        await syncSingleAniToMal(kind, mediaId);
      } catch (err) {
        addLog(`Live sync error: ${(err as Error).message}`, "warn");
      }
    }

    function configurePolling() {
      const settings = loadSettings();
      $cron.remove(POLL_CRON_ID);

      if (!settings.pollMalEnabled) {
        addLog("Polling MAL desactivado", "info");
        return;
      }

      const minutes = clamp(5, 60, settings.pollEveryMinutes);
      const cronExpr = `*/${minutes} * * * *`;
      $cron.add(POLL_CRON_ID, cronExpr, () => {
        if (isSyncing.get()) return;
        runSync("MAL_TO_ANI");
      });
      if (!$cron.hasStarted()) $cron.start();
      addLog(`Polling MAL activo cada ${minutes} min`, "info");
    }

    ctx.registerEventHandler("save-config", () => {
      $storage.set(STORAGE.CLIENT_ID, clientIdRef.current || "");
      $storage.set(STORAGE.CLIENT_SECRET, clientSecretRef.current || "");
      settingsFeedback.set("Configuración guardada ✅");
      addLog("Config MAL guardada", "success");
    });

    ctx.registerEventHandler("generate-verifier", () => {
      const verifier = generateCodeVerifier();
      $storage.set(STORAGE.PKCE_VERIFIER, verifier);
      settingsFeedback.set("Code verifier generado ✅");
      addLog("PKCE verifier generado", "success");
    });

    ctx.registerEventHandler("exchange-code", () => {
      void (async () => {
        try {
          await tokenManager.exchangeCode(authCodeRef.current || "");
          authFeedback.set("Conectado a MAL ✅");
          addLog("Autenticación MAL exitosa", "success");
        } catch (err) {
          authFeedback.set(`Error: ${(err as Error).message}`);
          addLog(`Auth MAL falló: ${(err as Error).message}`, "error");
        }
      })();
    });

    ctx.registerEventHandler("save-preferences", () => {
      saveSettingsFromRefs();
      configurePolling();
      settingsFeedback.set("Preferencias guardadas ✅");
      addLog("Preferencias guardadas", "success");
    });

    ctx.registerEventHandler("sync-default", () => {
      void runSync(modeRef.current || "BIDIRECTIONAL");
    });

    ctx.registerEventHandler("sync-ani-to-mal", () => {
      void runSync("ANI_TO_MAL");
    });

    ctx.registerEventHandler("sync-mal-to-ani", () => {
      void runSync("MAL_TO_ANI");
    });

    ctx.registerEventHandler("clear-logs", () => {
      logs.set([]);
      statusText.set("Logs limpiados");
    });

    $store.watch<{ mediaId?: number }>(POST_UPDATE_SIGNAL_KEY, (payload) => {
      void handlePostUpdate(payload?.mediaId);
    });

    configurePolling();

    const tray = ctx.newTray({
      iconUrl: ICON_URL,
      withContent: true,
      width: "500px",
      minHeight: "560px",
    });

    tray.render(() => {
      const authUrl = buildAuthUrl();
      const currentLogs = logs.get();

      return tray.stack([
          tray.text("MALSync Bidir", {
            style: { fontWeight: "bold", fontSize: "16px", textAlign: "center" },
          }),
          tray.text(`Estado: ${statusText.get()}`),
          tray.text(`Autenticado MAL: ${isAuthenticated.get() ? "Sí" : "No"}`),
          tray.text(`Última corrida: ${lastRun.get()}`),

          tray.text("Alcance actual: Anime + Manga core. num_volumes_read se ignora por diseño."),

          tray.text("---- Config MAL ----", { style: { fontWeight: "bold" } }),
          tray.input({ fieldRef: clientIdRef, label: "Client ID", placeholder: "MAL Client ID" }),
          tray.input({ fieldRef: clientSecretRef, label: "Client Secret", placeholder: "MAL Client Secret" }),
          tray.flex([
            tray.button({ label: "Guardar config", onClick: "save-config", intent: "gray-subtle" }),
            tray.button({ label: "Generar PKCE verifier", onClick: "generate-verifier", intent: "gray-subtle" }),
          ], { gap: 8 }),
          authUrl ? tray.anchor({
            href: authUrl,
            text: "Abrir autorización MAL",
            target: "_blank",
          }) : tray.text("Generá verifier para habilitar link de autorización"),
          tray.input({ fieldRef: authCodeRef, label: "Auth code o URL callback", placeholder: "Pegá el code o URL completa" }),
          tray.button({ label: "Intercambiar code por token", onClick: "exchange-code", intent: "primary" }),
          authFeedback.get() ? tray.text(authFeedback.get()) : null,

          tray.text("---- Preferencias ----", { style: { fontWeight: "bold" } }),
          tray.select({
            label: "Modo por defecto",
            fieldRef: modeRef,
            options: [
              { label: "BIDIRECTIONAL", value: "BIDIRECTIONAL" },
              { label: "ANI_TO_MAL", value: "ANI_TO_MAL" },
              { label: "MAL_TO_ANI", value: "MAL_TO_ANI" },
            ],
          }),
          tray.checkbox({ fieldRef: liveSyncRef, label: "Live sync AniList -> MAL por hooks" }),
          tray.checkbox({ fieldRef: includeAnimeRef, label: "Incluir Anime" }),
          tray.checkbox({ fieldRef: includeMangaRef, label: "Incluir Manga" }),
          tray.checkbox({ fieldRef: syncDeletionsRef, label: "Sincronizar borrados (cuidado)" }),
          tray.checkbox({ fieldRef: pollEnabledRef, label: "Polling MAL -> AniList" }),
          tray.input({ fieldRef: pollEveryMinutesRef, label: "Polling cada X min (5-60)", placeholder: "15" }),
          tray.button({ label: "Guardar preferencias", onClick: "save-preferences", intent: "gray-subtle" }),
          settingsFeedback.get() ? tray.text(settingsFeedback.get()) : null,

          tray.text("---- Acciones ----", { style: { fontWeight: "bold" } }),
          tray.flex([
            tray.button({ label: "Sync modo por defecto", onClick: "sync-default", intent: "primary" }),
            tray.button({ label: "ANI -> MAL", onClick: "sync-ani-to-mal", intent: "gray-subtle" }),
            tray.button({ label: "MAL -> ANI", onClick: "sync-mal-to-ani", intent: "gray-subtle" }),
            tray.button({ label: "Limpiar logs", onClick: "clear-logs", intent: "gray" }),
          ], { gap: 8 }),

          tray.text("---- Logs ----", { style: { fontWeight: "bold" } }),
          tray.stack(
            currentLogs.slice(0, 20).map((log) => tray.text(`[${log.at}] ${log.type.toUpperCase()}: ${log.message}`)),
            { gap: 4 },
          ),
        ].filter(Boolean as any), { gap: 12 });
    });

    addLog("Plugin cargado. Configurá OAuth y corré sync.", "info");
  });
}
