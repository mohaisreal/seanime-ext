/// <reference path="./plugin.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

type MediaKind = "ANIME" | "MANGA";
type SyncMode = "ANI_TO_MAL" | "MAL_TO_ANI" | "BIDIRECTIONAL";
type ConflictPolicy = "MOST_PROGRESS" | "ANILIST_WINS" | "MAL_WINS" | "SKIP";

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
  safeDeletions: boolean;
  conflictPolicy: ConflictPolicy;
  pollMalEnabled: boolean;
  pollEveryMinutes: number;
}

interface DebugEntry {
  at: string;
  action: string;
  detail: string;
}

interface SyncProgressState {
  current: number;
  total: number;
  label: string;
}

interface SyncBatchResult {
  changed: number;
  skipped: number;
  failed: number;
  deleted: number;
  conflicts: number;
}

interface PendingAniChange {
  mediaId: number;
  at: number;
  kind?: MediaKind;
  malId?: number;
}

interface SyncShadowRecord {
  ani: string;
  mal: string;
  winner?: "ANI" | "MAL" | "NONE";
  at: number;
}

interface ReferenceRecord {
  kind: MediaKind;
  aniId: number;
  malId: number;
  lastAniFingerprint?: string;
  lastMalFingerprint?: string;
  deletedOnAni?: boolean;
  deletedOnMal?: boolean;
  lastSeenAniAt?: number;
  lastSeenMalAt?: number;
  updatedAt: number;
}

interface ReferenceKindIndex {
  byAniId: Record<string, ReferenceRecord>;
  byMalId: Record<string, number>;
}

interface ReferenceIndex {
  version: number;
  ANIME: ReferenceKindIndex;
  MANGA: ReferenceKindIndex;
  builtAt?: number;
  updatedAt?: number;
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
  exists?: boolean;
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
  num_episodes_watched?: number;
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
  startedAt?: any;
  completedAt?: any;
}) {
  return `${entry.status ?? "null"}|${entry.score ?? 0}|${entry.progress ?? 0}|${entry.repeat ?? 0}|${entry.startedAt ?? ""}|${entry.completedAt ?? ""}`;
}

function init() {
  $app.onPostUpdateEntry((e) => {
    try {
      if (e.mediaId) {
        $store.set("malsync_bidir.signal.post_update", {
          mediaId: e.mediaId,
          event: "entry",
          at: Date.now(),
        });
      }
    } finally {
      e.next();
    }
  });

  $app.onPostUpdateEntryProgress((e) => {
    try {
      if (e.mediaId) {
        $store.set("malsync_bidir.signal.post_update", {
          mediaId: e.mediaId,
          event: "progress",
          at: Date.now(),
        });
      }
    } finally {
      e.next();
    }
  });

  $app.onPostUpdateEntryRepeat((e) => {
    try {
      if (e.mediaId) {
        $store.set("malsync_bidir.signal.post_update", {
          mediaId: e.mediaId,
          event: "repeat",
          at: Date.now(),
        });
      }
    } finally {
      e.next();
    }
  });

  $app.onPostDeleteEntry((e) => {
    try {
      if (e.mediaId) {
        $store.set("malsync_bidir.signal.post_update", {
          mediaId: e.mediaId,
          event: "delete",
          at: Date.now(),
        });
      }
    } finally {
      e.next();
    }
  });

  $ui.register((ctx) => {
    const POST_UPDATE_SIGNAL_KEY = "malsync_bidir.signal.post_update";
    const MAL_API_BASE = "https://api.myanimelist.net/v2";
    const MAL_TOKEN_URI = "https://myanimelist.net/v1/oauth2/token";
    const MAL_AUTH_URI = "https://myanimelist.net/v1/oauth2/authorize";
    const ICON_URL = "https://cdn.myanimelist.net/images/favicon.ico";
    const REDIRECT_URI = "http://localhost";
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
      SAFE_DELETIONS: "malsync_bidir.safeDeletions",
      CONFLICT_POLICY: "malsync_bidir.conflictPolicy",
      POLL_MAL_ENABLED: "malsync_bidir.pollMalEnabled",
      POLL_EVERY_MINUTES: "malsync_bidir.pollEveryMinutes",
      PENDING_ANI_TO_MAL: "malsync_bidir.pendingAniToMal",
      HISTORY_ANI_TO_MAL: "malsync_bidir.historyAniToMal",
      HISTORY_MAL_TO_ANI: "malsync_bidir.historyMalToAni",
      SYNC_SHADOW: "malsync_bidir.syncShadow",
      REFERENCE_INDEX: "malsync_bidir.referenceIndex",
      SETTINGS_SCHEMA_VERSION: "malsync_bidir.settingsSchemaVersion",
    };

    const SETTINGS_SCHEMA_VERSION = 3;

    const DEFAULT_SETTINGS: SyncSettings = {
      mode: "BIDIRECTIONAL",
      liveSync: true,
      includeAnime: true,
      includeManga: true,
      syncDeletions: false,
      safeDeletions: true,
      conflictPolicy: "MOST_PROGRESS",
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
      startedAt?: any;
      completedAt?: any;
    }) {
      return `${entry.status ?? "null"}|${entry.score ?? 0}|${entry.progress ?? 0}|${entry.repeat ?? 0}|${entry.startedAt ?? ""}|${entry.completedAt ?? ""}`;
    }

    const logs = ctx.state<LogEntry[]>([]);
    const debugLogs = ctx.state<DebugEntry[]>([]);
    const statusText = ctx.state("Idle");
    const isSyncing = ctx.state(false);
    const shouldCancelSync = ctx.state(false);
    const syncProgress = ctx.state<SyncProgressState>({ current: 0, total: 0, label: "Idle" });
    const activeSyncMode = ctx.state<SyncMode | null>(null);
    const lastRun = ctx.state<string>("Never");
    const lastSyncSummary = ctx.state<{
      intent: "info" | "success" | "warning" | "alert";
      title: string;
      detail: string;
    }>({
      intent: "info",
      title: "Ready",
      detail: "Choose a sync mode to start.",
    });
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
    const safeDeletionsRef = ctx.fieldRef<boolean>($storage.get(STORAGE.SAFE_DELETIONS) ?? DEFAULT_SETTINGS.safeDeletions);
    const conflictPolicyRef = ctx.fieldRef<ConflictPolicy>(($storage.get(STORAGE.CONFLICT_POLICY) as ConflictPolicy) || DEFAULT_SETTINGS.conflictPolicy);
    const pollEnabledRef = ctx.fieldRef<boolean>($storage.get(STORAGE.POLL_MAL_ENABLED) ?? DEFAULT_SETTINGS.pollMalEnabled);
    const pollEveryMinutesRef = ctx.fieldRef<string>(String($storage.get(STORAGE.POLL_EVERY_MINUTES) ?? DEFAULT_SETTINGS.pollEveryMinutes));
    let stopPollingTimer: (() => void) | undefined;

    function addLog(message: string, type: LogEntry["type"] = "info") {
      logs.set((prev) => [{ at: nowHHMMSS(), type, message }, ...prev].slice(0, 250));
      statusText.set(message);
    }

    function migrateSettingsIfNeeded() {
      const currentVersion = asNumber($storage.get(STORAGE.SETTINGS_SCHEMA_VERSION), 0);
      if (currentVersion >= SETTINGS_SCHEMA_VERSION) return;

      if (currentVersion < 2) {
        const storedMode = $storage.get(STORAGE.MODE) as SyncMode | undefined;
        if (!storedMode || storedMode === "ANI_TO_MAL") {
          $storage.set(STORAGE.MODE, "BIDIRECTIONAL");
          modeRef.setValue("BIDIRECTIONAL");
          addLog("Migrated default mode to BIDIRECTIONAL. ANI_TO_MAL now only pushes queued changes.", "info");
        }
      }

      if (currentVersion < 3 && !$storage.get(STORAGE.REFERENCE_INDEX)) {
        saveReferenceIndex(createEmptyReferenceIndex());
        addLog("Initialized AniList ↔ MAL reference index", "info");
      }

      $storage.set(STORAGE.SETTINGS_SCHEMA_VERSION, SETTINGS_SCHEMA_VERSION);
    }

    function addDebug(action: string, detail: any) {
      debugLogs.set((prev) => [{
        at: nowHHMMSS(),
        action,
        detail: typeof detail === "string" ? detail : safeJson(detail),
      }, ...prev].slice(0, 200));
    }

    function setProgress(current: number, total: number, label: string) {
      syncProgress.set({ current, total, label });
    }

    function resetProgress(label = "Idle") {
      syncProgress.set({ current: 0, total: 0, label });
    }

    function makeResult(partial?: Partial<SyncBatchResult>): SyncBatchResult {
      return {
        changed: partial?.changed ?? 0,
        skipped: partial?.skipped ?? 0,
        failed: partial?.failed ?? 0,
        deleted: partial?.deleted ?? 0,
        conflicts: partial?.conflicts ?? 0,
      };
    }

    function mergeResults(...items: SyncBatchResult[]) {
      return items.reduce((acc, item) => ({
        changed: acc.changed + item.changed,
        skipped: acc.skipped + item.skipped,
        failed: acc.failed + item.failed,
        deleted: acc.deleted + item.deleted,
        conflicts: acc.conflicts + item.conflicts,
      }), makeResult());
    }

    function wait(ms: number) {
      return new Promise<void>((resolve) => {
        ctx.setTimeout(resolve, ms);
      });
    }

    function toErrorMessage(err: unknown) {
      if (!err) return "Unknown error";
      if (typeof err === "string") return err;
      return (err as any)?.message || String(err);
    }

    function explainSyncError(rawMessage: string) {
      if (/context deadline exceeded/i.test(rawMessage)) {
        return "MAL request timed out (possible rate limit or latency). Try again in 1-2 minutes.";
      }
      if (/error\.json/i.test(rawMessage)) {
        return "MAL returned an error endpoint. This usually means timeout, rate limit, or an invalid payload.";
      }
      return rawMessage;
    }

    function assertValidMalId(kind: MediaKind, malIdRaw: any, phase: string): number {
      const malId = Number(malIdRaw);
      if (!Number.isInteger(malId) || malId <= 0) {
        throw new Error(`[${phase}] Invalid MAL ID for ${kind}: ${String(malIdRaw)}`);
      }
      return malId;
    }

    async function fetchWithRetry(
      url: string,
      options: $ui.FetchOptions,
      label: string,
      attempts = 1,
    ) {
      let lastError: any;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const reqOptions = options?.timeout ? options : { ...options, timeout: 30 };
          const res = await ctx.fetch(url, reqOptions);
          const shouldRetryStatus = res.status === 429 || res.status >= 500;
          if (shouldRetryStatus && attempt < attempts) {
            addLog(`${label}: HTTP ${res.status}, retry ${attempt + 1}/${attempts}`, "warn");
            await wait(600 * attempt);
            continue;
          }
          if (shouldRetryStatus) {
            addLog(`${label}: HTTP ${res.status}; skipped after first failed attempt`, "warn");
            addDebug("FETCH_SKIPPED", { label, url, status: res.status });
          }
          return res;
        } catch (err) {
          lastError = err;
          const msg = toErrorMessage(err);
          const retryable = /deadline exceeded|timeout|temporarily unavailable|connection reset|eof/i.test(msg);
          if (retryable && attempt < attempts) {
            addLog(`${label}: network timeout, retry ${attempt + 1}/${attempts}`, "warn");
            await wait(700 * attempt);
            continue;
          }
          addLog(`${label}: skipped after fetch failure: ${explainSyncError(msg)}`, "warn");
          addDebug("FETCH_FAILED", { label, url, error: msg });
          return undefined;
        }
      }
      addLog(`${label}: skipped after fetch failure: ${explainSyncError(toErrorMessage(lastError))}`, "warn");
      addDebug("FETCH_FAILED", { label, url, error: toErrorMessage(lastError) });
      return undefined;
    }

    function loadSettings(): SyncSettings {
      return {
        mode: (($storage.get(STORAGE.MODE) as SyncMode) || DEFAULT_SETTINGS.mode),
        liveSync: $storage.get(STORAGE.LIVE_SYNC) ?? DEFAULT_SETTINGS.liveSync,
        includeAnime: $storage.get(STORAGE.INCLUDE_ANIME) ?? DEFAULT_SETTINGS.includeAnime,
        includeManga: $storage.get(STORAGE.INCLUDE_MANGA) ?? DEFAULT_SETTINGS.includeManga,
        syncDeletions: $storage.get(STORAGE.SYNC_DELETIONS) ?? DEFAULT_SETTINGS.syncDeletions,
        safeDeletions: $storage.get(STORAGE.SAFE_DELETIONS) ?? DEFAULT_SETTINGS.safeDeletions,
        conflictPolicy: (($storage.get(STORAGE.CONFLICT_POLICY) as ConflictPolicy) || DEFAULT_SETTINGS.conflictPolicy),
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
      $storage.set(STORAGE.SAFE_DELETIONS, !!safeDeletionsRef.current);
      $storage.set(STORAGE.CONFLICT_POLICY, conflictPolicyRef.current || DEFAULT_SETTINGS.conflictPolicy);
      $storage.set(STORAGE.POLL_MAL_ENABLED, !!pollEnabledRef.current);
      $storage.set(STORAGE.POLL_EVERY_MINUTES, pollEvery);
      pollEveryMinutesRef.setValue(String(pollEvery));
    }

    function loadPendingQueue(): Record<string, PendingAniChange> {
      return ($storage.get(STORAGE.PENDING_ANI_TO_MAL) || {}) as Record<string, PendingAniChange>;
    }

    function savePendingQueue(queue: Record<string, PendingAniChange>) {
      $storage.set(STORAGE.PENDING_ANI_TO_MAL, queue);
    }

    function createEmptyReferenceKindIndex(): ReferenceKindIndex {
      return { byAniId: {}, byMalId: {} };
    }

    function createEmptyReferenceIndex(): ReferenceIndex {
      return {
        version: 1,
        ANIME: createEmptyReferenceKindIndex(),
        MANGA: createEmptyReferenceKindIndex(),
        builtAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    function normalizeReferenceIndex(raw: any): ReferenceIndex {
      const index = (raw || {}) as Partial<ReferenceIndex>;
      return {
        version: asNumber(index.version, 1),
        ANIME: {
          byAniId: index.ANIME?.byAniId || {},
          byMalId: index.ANIME?.byMalId || {},
        },
        MANGA: {
          byAniId: index.MANGA?.byAniId || {},
          byMalId: index.MANGA?.byMalId || {},
        },
        builtAt: asNumber(index.builtAt, Date.now()),
        updatedAt: asNumber(index.updatedAt, Date.now()),
      };
    }

    function loadReferenceIndex(): ReferenceIndex {
      return normalizeReferenceIndex($storage.get(STORAGE.REFERENCE_INDEX));
    }

    function saveReferenceIndex(index: ReferenceIndex) {
      index.updatedAt = Date.now();
      $storage.set(STORAGE.REFERENCE_INDEX, index);
    }

    function getReferenceBucket(index: ReferenceIndex, kind: MediaKind): ReferenceKindIndex {
      if (kind === "ANIME") {
        if (!index.ANIME) index.ANIME = createEmptyReferenceKindIndex();
        return index.ANIME;
      }
      if (!index.MANGA) index.MANGA = createEmptyReferenceKindIndex();
      return index.MANGA;
    }

    function putReferenceRecord(index: ReferenceIndex, record: ReferenceRecord) {
      const bucket = getReferenceBucket(index, record.kind);
      const aniKey = String(record.aniId);
      const malKey = String(record.malId);
      const previous = bucket.byAniId[aniKey];
      if (previous && previous.malId !== record.malId) {
        delete bucket.byMalId[String(previous.malId)];
      }

      const previousAniForMal = bucket.byMalId[malKey];
      if (previousAniForMal && previousAniForMal !== record.aniId) {
        delete bucket.byAniId[String(previousAniForMal)];
      }

      bucket.byAniId[aniKey] = record;
      bucket.byMalId[malKey] = record.aniId;
    }

    function removeReferenceRecord(index: ReferenceIndex, kind: MediaKind, aniId?: number, malId?: number) {
      const bucket = getReferenceBucket(index, kind);
      const resolvedAniId = aniId || (malId ? bucket.byMalId[String(malId)] : undefined);
      const record = resolvedAniId ? bucket.byAniId[String(resolvedAniId)] : undefined;
      if (record) {
        delete bucket.byAniId[String(record.aniId)];
        delete bucket.byMalId[String(record.malId)];
        return;
      }
      if (malId) delete bucket.byMalId[String(malId)];
    }

    function getReferenceByAniId(index: ReferenceIndex, kind: MediaKind, aniId: number) {
      return getReferenceBucket(index, kind).byAniId[String(aniId)];
    }

    function getReferenceByMalId(index: ReferenceIndex, kind: MediaKind, malId: number) {
      const bucket = getReferenceBucket(index, kind);
      const aniId = bucket.byMalId[String(malId)];
      return aniId ? bucket.byAniId[String(aniId)] : undefined;
    }

    function upsertReferenceLite(kind: MediaKind, aniId: number, malId: number, patch?: Partial<ReferenceRecord>) {
      if (!aniId || !malId) return;
      const index = loadReferenceIndex();
      const existing = getReferenceByAniId(index, kind, aniId) || getReferenceByMalId(index, kind, malId);
      putReferenceRecord(index, {
        kind,
        aniId,
        malId,
        lastAniFingerprint: existing?.lastAniFingerprint,
        lastMalFingerprint: existing?.lastMalFingerprint,
        deletedOnAni: false,
        deletedOnMal: false,
        lastSeenAniAt: existing?.lastSeenAniAt,
        lastSeenMalAt: existing?.lastSeenMalAt,
        updatedAt: Date.now(),
        ...patch,
      });
      saveReferenceIndex(index);
    }

    function markReferenceDeletedOnAni(kind: MediaKind, aniId: number, malId?: number) {
      const index = loadReferenceIndex();
      const existing = getReferenceByAniId(index, kind, aniId) || (malId ? getReferenceByMalId(index, kind, malId) : undefined);
      if (!existing && !malId) return;

      putReferenceRecord(index, {
        kind,
        aniId,
        malId: existing?.malId || malId!,
        lastAniFingerprint: existing?.lastAniFingerprint,
        lastMalFingerprint: existing?.lastMalFingerprint,
        deletedOnAni: true,
        deletedOnMal: existing?.deletedOnMal,
        lastSeenAniAt: existing?.lastSeenAniAt,
        lastSeenMalAt: existing?.lastSeenMalAt,
        updatedAt: Date.now(),
      });
      saveReferenceIndex(index);
    }

    function purgeReference(kind: MediaKind, aniId?: number, malId?: number) {
      const index = loadReferenceIndex();
      removeReferenceRecord(index, kind, aniId, malId);
      saveReferenceIndex(index);
    }

    function referenceCount(kind?: MediaKind) {
      const index = loadReferenceIndex();
      if (kind) return Object.keys(getReferenceBucket(index, kind).byAniId).length;
      return Object.keys(index.ANIME.byAniId).length + Object.keys(index.MANGA.byAniId).length;
    }

    function resolveReferenceForMedia(mediaId: number): { kind?: MediaKind; malId?: number; ref?: ReferenceRecord } {
      const index = loadReferenceIndex();
      const animeRef = getReferenceByAniId(index, "ANIME", mediaId);
      if (animeRef) return { kind: "ANIME", malId: animeRef.malId, ref: animeRef };

      const mangaRef = getReferenceByAniId(index, "MANGA", mediaId);
      if (mangaRef) return { kind: "MANGA", malId: mangaRef.malId, ref: mangaRef };

      return {};
    }

    function queuePendingAniToMal(mediaId?: number, event?: string) {
      if (!mediaId) return;

      const settings = loadSettings();
      const queue = loadPendingQueue();
      const resolved = resolveReferenceForMedia(mediaId);
      let kind = resolved.kind;
      let malId = resolved.malId;

      if (!kind || !malId) {
        try {
          const anime = $anilist.getAnime(mediaId);
          if (anime?.idMal) {
            kind = "ANIME";
            malId = Number(anime.idMal);
          }
        } catch (_) { /* noop */ }

        if (!kind) {
          try {
            const manga = $anilist.getManga(mediaId);
            if (manga?.idMal) {
              kind = "MANGA";
              malId = Number(manga.idMal);
            }
          } catch (_) { /* noop */ }
        }
      }

      if (kind && malId) {
        if (event === "delete") {
          markReferenceDeletedOnAni(kind, mediaId, malId);
          if (!settings.syncDeletions) {
            purgeReference(kind, mediaId, malId);
            addDebug("REFERENCE_PURGED_AFTER_ANI_DELETE", { mediaId, kind, malId, reason: "sync deletions disabled" });
            return;
          }
        } else {
          upsertReferenceLite(kind, mediaId, malId, {
            deletedOnAni: false,
            lastSeenAniAt: Date.now(),
          });
        }
      }

      queue[String(mediaId)] = { mediaId, at: Date.now(), kind, malId };
      savePendingQueue(queue);
      addDebug("PENDING_ANI_TO_MAL_QUEUED", { mediaId, kind, malId, event, pending: Object.keys(queue).length });
    }

    function removePending(mediaId: number) {
      const queue = loadPendingQueue();
      delete queue[String(mediaId)];
      savePendingQueue(queue);
    }

    function pendingCount() {
      return Object.keys(loadPendingQueue()).length;
    }

    function loadHistory(storageKey: string): Record<string, number[]> {
      return ($storage.get(storageKey) || {}) as Record<string, number[]>;
    }

    function getHistorySet(storageKey: string, kind: MediaKind) {
      return new Set<number>((loadHistory(storageKey)[kind] || []).map((v) => Number(v)).filter(Boolean));
    }

    function saveHistorySet(storageKey: string, kind: MediaKind, ids: Set<number>) {
      const history = loadHistory(storageKey);
      history[kind] = Array.from(ids.values()).filter(Boolean);
      $storage.set(storageKey, history);
    }

    function loadShadow(kind: MediaKind): Record<string, SyncShadowRecord> {
      const all = ($storage.get(STORAGE.SYNC_SHADOW) || {}) as Record<string, Record<string, SyncShadowRecord>>;
      return all[kind] || {};
    }

    function saveShadow(kind: MediaKind, shadow: Record<string, SyncShadowRecord>) {
      const all = ($storage.get(STORAGE.SYNC_SHADOW) || {}) as Record<string, Record<string, SyncShadowRecord>>;
      all[kind] = shadow;
      $storage.set(STORAGE.SYNC_SHADOW, all);
    }

    function canSafeDelete(storageKey: string, kind: MediaKind, malId: number, settings: SyncSettings) {
      if (!settings.syncDeletions) return false;
      if (!settings.safeDeletions) return true;
      return getHistorySet(storageKey, kind).has(malId);
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
        if (!clientId || !verifier) throw new Error("Missing client_id or code_verifier");

        let code = authCodeOrUrl.trim();
        if (code.includes("code=")) {
          const match = code.match(/[?&]code=([^&]+)/);
          if (match?.[1]) code = decodeURIComponent(match[1]);
        }
        if (!code) throw new Error("Auth code not found");

        const body = encodeForm({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret || undefined,
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
        });

        const res = await fetchWithRetry(MAL_TOKEN_URI, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        }, "Token exchange");

        if (!res) throw new Error("Token exchange skipped after fetch failure");
        if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
        const data = await res.json();
        saveTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + (asNumber(data.expires_in, 3600) * 1000),
        });
      },

      async refreshIfNeeded() {
        const current = getStoredTokens();
        if (!current.accessToken || !current.refreshToken) throw new Error("No saved MAL tokens");
        const expiresAt = current.expiresAt || 0;
        if (Date.now() < (expiresAt - 30_000)) return current.accessToken;

        const clientId = $storage.get(STORAGE.CLIENT_ID) || "";
        const clientSecret = $storage.get(STORAGE.CLIENT_SECRET) || "";
        if (!clientId) throw new Error("Missing client_id");

        const body = encodeForm({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: clientId,
          client_secret: clientSecret || undefined,
        });

        const res = await fetchWithRetry(MAL_TOKEN_URI, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        }, "Token refresh");

        if (!res) throw new Error("Token refresh skipped after fetch failure");
        if (!res.ok) throw new Error(`Refresh token failed (${res.status})`);
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
      async fetchPaged<T>(url: string): Promise<T[] | undefined> {
        const out: T[] = [];
        let nextUrl: string | undefined = url;
        let guard = 0;

        while (nextUrl && guard < 10_000) {
          guard += 1;
          let headers: Record<string, string>;
          try {
            headers = await tokenManager.withAuthHeaders();
          } catch (err) {
            addLog(`MAL fetch list skipped: ${toErrorMessage(err)}`, "warn");
            addDebug("MAL_LIST_AUTH_FAILED", { url: nextUrl, error: toErrorMessage(err) });
            return undefined;
          }

          const res = await fetchWithRetry(nextUrl, { headers }, "MAL fetch list");
          if (!res) return undefined;
          if (!res.ok) {
            addLog(`MAL list fetch skipped (${res.status})`, "warn");
            addDebug("MAL_LIST_FETCH_FAILED", { url: nextUrl, status: res.status });
            return undefined;
          }

          const page = await res.json() as MalListPage;
          const data = page?.data || [];
          for (const item of data) out.push(item as unknown as T);
          nextUrl = page?.paging?.next;
        }
        return out;
      },

      async fetchAnimeList() {
        const fields = "fields=list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date}";
        const url = `${MAL_API_BASE}/users/@me/animelist?${fields}&limit=1000`;
        return await malClient.fetchPaged<MalListItem<MalAnimeListStatusPayload>>(url);
      },

      async fetchMangaList() {
        const fields = "fields=list_status{status,score,num_chapters_read,is_rereading,num_times_reread,start_date,finish_date}";
        const url = `${MAL_API_BASE}/users/@me/mangalist?${fields}&limit=1000`;
        return await malClient.fetchPaged<MalListItem<MalMangaListStatusPayload>>(url);
      },

      async getAnimeStatus(malId: number): Promise<MalCoreEntry | undefined> {
        malId = assertValidMalId("ANIME", malId, "getAnimeStatus");
        const res = await fetchWithRetry(
          `${MAL_API_BASE}/anime/${malId}?fields=my_list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,start_date,finish_date}`,
          { headers: await tokenManager.withAuthHeaders() },
          `MAL get anime ${malId}`,
        );
        if (!res) return undefined;
        if (!res.ok) {
          if (res.status === 404) return undefined;
          addLog(`Could not read MAL anime status (${res.status}); skipped`, "warn");
          return undefined;
        }
        const data = await res.json();
        return toMalCoreFromAnimePayload(malId, data?.my_list_status);
      },

      async getMangaStatus(malId: number): Promise<MalCoreEntry | undefined> {
        malId = assertValidMalId("MANGA", malId, "getMangaStatus");
        const res = await fetchWithRetry(
          `${MAL_API_BASE}/manga/${malId}?fields=my_list_status{status,score,num_chapters_read,is_rereading,num_times_reread,start_date,finish_date}`,
          { headers: await tokenManager.withAuthHeaders() },
          `MAL get manga ${malId}`,
        );
        if (!res) return undefined;
        if (!res.ok) {
          if (res.status === 404) return undefined;
          addLog(`Could not read MAL manga status (${res.status}); skipped`, "warn");
          return undefined;
        }
        const data = await res.json();
        return toMalCoreFromMangaPayload(malId, data?.my_list_status);
      },

      async upsertAnime(target: MalCoreEntry) {
        try {
          const malId = assertValidMalId("ANIME", target.malId, "upsertAnime");
          const body = encodeForm({
            status: target.status as MalAnimeStatus,
            score: clamp(0, 10, target.score),
            num_watched_episodes: Math.max(0, target.progress),
            is_rewatching: target.repeat > 0,
            num_times_rewatched: Math.max(0, target.repeat),
            start_date: target.startedAt,
            finish_date: target.completedAt,
          });

          const res = await fetchWithRetry(`${MAL_API_BASE}/anime/${malId}/my_list_status`, {
            method: "PUT",
            headers: {
              ...(await tokenManager.withAuthHeaders()),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          }, `MAL upsert anime ${malId}`);
          if (!res || !res.ok) {
            addDebug("MAL_UPSERT_ANIME_FAILED", { malId, status: res?.status, target });
            return false;
          }
          const responseBody = await readJsonBody(res);
          const verification = await verifyMalWrite("ANIME", target, responseBody);
          if (!verification.ok) {
            addLog(`MAL anime ${malId} update not confirmed; kept pending`, "warn");
            addDebug("MAL_UPSERT_ANIME_VERIFY_FAILED", {
              malId,
              target,
              response: verification.response,
              current: verification.current,
            });
            return false;
          }
          addDebug("MAL_UPSERT_ANIME", { malId, target, confirmed: verification.current, source: verification.source });
          return true;
        } catch (err) {
          addLog(`MAL upsert anime skipped: ${toErrorMessage(err)}`, "warn");
          addDebug("MAL_UPSERT_ANIME_ERROR", { target, error: toErrorMessage(err) });
          return false;
        }
      },

      async upsertManga(target: MalCoreEntry) {
        try {
          const malId = assertValidMalId("MANGA", target.malId, "upsertManga");
          const body = encodeForm({
            status: target.status as MalMangaStatus,
            score: clamp(0, 10, target.score),
            num_chapters_read: Math.max(0, target.progress),
            is_rereading: target.repeat > 0,
            num_times_reread: Math.max(0, target.repeat),
            start_date: target.startedAt,
            finish_date: target.completedAt,
          });

          const res = await fetchWithRetry(`${MAL_API_BASE}/manga/${malId}/my_list_status`, {
            method: "PUT",
            headers: {
              ...(await tokenManager.withAuthHeaders()),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          }, `MAL upsert manga ${malId}`);
          if (!res || !res.ok) {
            addDebug("MAL_UPSERT_MANGA_FAILED", { malId, status: res?.status, target });
            return false;
          }
          const responseBody = await readJsonBody(res);
          const verification = await verifyMalWrite("MANGA", target, responseBody);
          if (!verification.ok) {
            addLog(`MAL manga ${malId} update not confirmed; kept pending`, "warn");
            addDebug("MAL_UPSERT_MANGA_VERIFY_FAILED", {
              malId,
              target,
              response: verification.response,
              current: verification.current,
            });
            return false;
          }
          addDebug("MAL_UPSERT_MANGA", { malId, target, confirmed: verification.current, source: verification.source });
          return true;
        } catch (err) {
          addLog(`MAL upsert manga skipped: ${toErrorMessage(err)}`, "warn");
          addDebug("MAL_UPSERT_MANGA_ERROR", { target, error: toErrorMessage(err) });
          return false;
        }
      },

      async remove(kind: MediaKind, malId: number) {
        try {
          malId = assertValidMalId(kind, malId, "remove");
          const endpoint = kind === "ANIME" ? "anime" : "manga";
          const res = await fetchWithRetry(`${MAL_API_BASE}/${endpoint}/${malId}/my_list_status`, {
            method: "DELETE",
            headers: await tokenManager.withAuthHeaders(),
          }, `MAL delete ${kind} ${malId}`);
          if (!res) return false;
          if (!res.ok && res.status !== 404) {
            addDebug("MAL_DELETE_FAILED", { kind, malId, status: res.status });
            return false;
          }
          addDebug("MAL_DELETE", { kind, malId });
          return true;
        } catch (err) {
          addLog(`MAL delete skipped: ${toErrorMessage(err)}`, "warn");
          addDebug("MAL_DELETE_ERROR", { kind, malId, error: toErrorMessage(err) });
          return false;
        }
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
                exists: true,
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
              exists: true,
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
        try {
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
        } catch (err) {
          addLog(`AniList ID lookup skipped for ${kind} MAL ${malId}: ${toErrorMessage(err)}`, "warn");
          addDebug("ANILIST_LOOKUP_FAILED", { kind, malId, error: toErrorMessage(err) });
          return undefined;
        }
      },

      upsertEntry(mediaId: number, patch: AniPatch) {
        try {
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
          addDebug("ANILIST_UPSERT", { mediaId, patch });
          return true;
        } catch (err) {
          addLog(`AniList upsert skipped for ${mediaId}: ${toErrorMessage(err)}`, "warn");
          addDebug("ANILIST_UPSERT_FAILED", { mediaId, patch, error: toErrorMessage(err) });
          return false;
        }
      },

      deleteEntry(mediaId: number) {
        try {
          $anilist.deleteEntry(mediaId);
          addDebug("ANILIST_DELETE", { mediaId });
          return true;
        } catch (err) {
          addLog(`AniList delete skipped for ${mediaId}: ${toErrorMessage(err)}`, "warn");
          addDebug("ANILIST_DELETE_FAILED", { mediaId, error: toErrorMessage(err) });
          return false;
        }
      },

      refresh(kind: MediaKind) {
        if (kind === "ANIME") $anilist.refreshAnimeCollection();
        else $anilist.refreshMangaCollection();
      },
    };

    function toMalCoreFromAnimePayload(malId: number, listStatus?: MalAnimeListStatusPayload): MalCoreEntry {
      const progress = listStatus?.num_episodes_watched ?? listStatus?.num_watched_episodes;
      return {
        kind: "ANIME",
        malId,
        status: listStatus?.status,
        score: asNumber(listStatus?.score, 0),
        progress: asNumber(progress, 0),
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
        malId: asNumber(ani.malId, 0),
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

    function putReferenceFromAniCore(index: ReferenceIndex, aniCore: AniCoreEntry, malCore?: MalCoreEntry) {
      const target = toMalCoreFromAniCore(aniCore);
      const existing = getReferenceByAniId(index, aniCore.kind, aniCore.mediaId) || getReferenceByMalId(index, aniCore.kind, aniCore.malId);
      putReferenceRecord(index, {
        kind: aniCore.kind,
        aniId: aniCore.mediaId,
        malId: aniCore.malId,
        lastAniFingerprint: coreFingerprint(target),
        lastMalFingerprint: malCore ? coreFingerprint(malCore) : existing?.lastMalFingerprint,
        deletedOnAni: false,
        deletedOnMal: malCore ? false : existing?.deletedOnMal,
        lastSeenAniAt: Date.now(),
        lastSeenMalAt: malCore ? Date.now() : existing?.lastSeenMalAt,
        updatedAt: Date.now(),
      });
    }

    function putReferenceFromMalCore(index: ReferenceIndex, kind: MediaKind, aniId: number, malCore: MalCoreEntry, aniCore?: AniCoreEntry) {
      const existing = getReferenceByAniId(index, kind, aniId) || getReferenceByMalId(index, kind, malCore.malId);
      putReferenceRecord(index, {
        kind,
        aniId,
        malId: malCore.malId,
        lastAniFingerprint: aniCore ? coreFingerprint(toMalCoreFromAniCore(aniCore)) : existing?.lastAniFingerprint,
        lastMalFingerprint: coreFingerprint(malCore),
        deletedOnAni: aniCore ? false : existing?.deletedOnAni,
        deletedOnMal: false,
        lastSeenAniAt: aniCore ? Date.now() : existing?.lastSeenAniAt,
        lastSeenMalAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    function confirmReferenceSynced(kind: MediaKind, aniCore: AniCoreEntry, confirmedMal?: MalCoreEntry) {
      const index = loadReferenceIndex();
      putReferenceFromAniCore(index, aniCore, confirmedMal || toMalCoreFromAniCore(aniCore));
      saveReferenceIndex(index);
    }

    function confirmReferenceMalSynced(kind: MediaKind, aniId: number, malCore: MalCoreEntry) {
      const index = loadReferenceIndex();
      const fp = coreFingerprint(malCore);
      putReferenceRecord(index, {
        kind,
        aniId,
        malId: malCore.malId,
        lastAniFingerprint: fp,
        lastMalFingerprint: fp,
        deletedOnAni: false,
        deletedOnMal: false,
        lastSeenAniAt: Date.now(),
        lastSeenMalAt: Date.now(),
        updatedAt: Date.now(),
      });
      saveReferenceIndex(index);
    }

    function reconcileReferenceIndex(kind: MediaKind, aniMap: Map<number, AniCoreEntry>, malMap: Map<number, MalCoreEntry>) {
      const index = loadReferenceIndex();
      const bucket = getReferenceBucket(index, kind);
      const now = Date.now();
      let linked = 0;
      let tombstoned = 0;
      let purged = 0;

      for (const [malId, aniCore] of aniMap.entries()) {
        putReferenceFromAniCore(index, aniCore, malMap.get(malId));
        linked += 1;
      }

      for (const [malId, malCore] of malMap.entries()) {
        const existing = getReferenceByMalId(index, kind, malId);
        if (!existing) continue;
        const aniCore = aniMap.get(malId);
        putReferenceFromMalCore(index, kind, existing.aniId, malCore, aniCore);
      }

      for (const record of Object.values({ ...bucket.byAniId })) {
        const hasAni = aniMap.has(record.malId);
        const hasMal = malMap.has(record.malId);

        if (!hasAni && !hasMal) {
          removeReferenceRecord(index, kind, record.aniId, record.malId);
          purged += 1;
          continue;
        }

        if (!hasAni || !hasMal) {
          putReferenceRecord(index, {
            ...record,
            deletedOnAni: !hasAni,
            deletedOnMal: !hasMal,
            lastSeenAniAt: hasAni ? now : record.lastSeenAniAt,
            lastSeenMalAt: hasMal ? now : record.lastSeenMalAt,
            updatedAt: now,
          });
          tombstoned += 1;
        }
      }

      saveReferenceIndex(index);
      addDebug("REFERENCE_INDEX_RECONCILED", { kind, linked, tombstoned, purged, total: referenceCount(kind) });
    }

    async function readJsonBody(res: any) {
      try {
        return await res.json();
      } catch (_) {
        return undefined;
      }
    }

    function extractMalStatusPayload(data: any) {
      return data?.my_list_status || data?.list_status || data;
    }

    async function verifyMalWrite(kind: MediaKind, target: MalCoreEntry, responseBody: any) {
      const payload = extractMalStatusPayload(responseBody);
      const response = payload
        ? kind === "ANIME"
          ? toMalCoreFromAnimePayload(target.malId, payload as MalAnimeListStatusPayload)
          : toMalCoreFromMangaPayload(target.malId, payload as MalMangaListStatusPayload)
        : undefined;

      if (response && !needsMalUpdate(response, target)) {
        return { ok: true, source: "response", response, current: response };
      }

      await wait(500);
      const current = kind === "ANIME"
        ? await malClient.getAnimeStatus(target.malId)
        : await malClient.getMangaStatus(target.malId);

      if (current && !needsMalUpdate(current, target)) {
        return { ok: true, source: "read-after-write", response, current };
      }

      return { ok: false, source: "read-after-write", response, current };
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
              exists: Boolean(entry?.listData),
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
            exists: Boolean(entry?.listData),
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

    async function buildMalMap(kind: MediaKind): Promise<Map<number, MalCoreEntry> | undefined> {
      const malMap = new Map<number, MalCoreEntry>();
      const items = kind === "ANIME" ? await malClient.fetchAnimeList() : await malClient.fetchMangaList();
      if (!items) return undefined;

      for (const item of items) {
        const malId = asNumber(item?.node?.id, 0);
        if (!malId) continue;
        malMap.set(
          malId,
          kind === "ANIME"
            ? toMalCoreFromAnimePayload(malId, item.list_status as MalAnimeListStatusPayload)
            : toMalCoreFromMangaPayload(malId, item.list_status as MalMangaListStatusPayload),
        );
      }
      return malMap;
    }

    async function pushAniToMal(kind: MediaKind, aniCore: AniCoreEntry) {
      const target = toMalCoreFromAniCore(aniCore);
      const ok = kind === "ANIME"
        ? await malClient.upsertAnime(target)
        : await malClient.upsertManga(target);
      if (ok) {
        markRecent(kind, target.malId, coreFingerprint(target));
        confirmReferenceSynced(kind, aniCore, target);
      }
      return ok;
    }

    function pushMalToAni(kind: MediaKind, malCore: MalCoreEntry, currentAni?: AniCoreEntry) {
      let mediaId = currentAni?.mediaId;
      if (!mediaId) {
        mediaId = aniListAdapter.resolveAniMediaIdByMalId(kind, malCore.malId);
      }
      if (!mediaId) {
        addLog(`Skipped ${kind} MAL ${malCore.malId}: no AniList match`, "warn");
        addDebug("MAL_TO_ANI_NO_MATCH", { kind, malId: malCore.malId });
        return false;
      }
      const patch = toAniPatchFromMalCore(malCore);
      const ok = aniListAdapter.upsertEntry(mediaId, patch);
      if (ok) {
        markRecent(kind, malCore.malId, coreFingerprint(malCore));
        confirmReferenceMalSynced(kind, mediaId, malCore);
      }
      return ok;
    }

    function resolveConflictWinner(settings: SyncSettings, aniTarget: MalCoreEntry, malCore: MalCoreEntry): "ANI" | "MAL" | "SKIP" {
      if (settings.conflictPolicy === "ANILIST_WINS") return "ANI";
      if (settings.conflictPolicy === "MAL_WINS") return "MAL";
      if (settings.conflictPolicy === "SKIP") return "SKIP";

      if (aniTarget.progress !== malCore.progress) return aniTarget.progress > malCore.progress ? "ANI" : "MAL";
      if (aniTarget.repeat !== malCore.repeat) return aniTarget.repeat > malCore.repeat ? "ANI" : "MAL";

      const aniCompleted = aniTarget.status === "completed";
      const malCompleted = malCore.status === "completed";
      if (aniCompleted !== malCompleted) return aniCompleted ? "ANI" : "MAL";

      return "ANI";
    }

    async function syncSingleAniToMal(kind: MediaKind, mediaId: number, fallbackMalId?: number): Promise<"changed" | "skipped" | "failed" | "deleted"> {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return "skipped";
      if (kind === "MANGA" && !settings.includeManga) return "skipped";

      try {
        const aniCore = await getAniCoreFromCtxEntry(kind, mediaId);
        if (!aniCore) {
          if (fallbackMalId && canSafeDelete(STORAGE.HISTORY_ANI_TO_MAL, kind, fallbackMalId, settings)) {
            const deleted = await malClient.remove(kind, fallbackMalId);
            if (deleted) {
              purgeReference(kind, mediaId, fallbackMalId);
              return "deleted";
            }
            return "failed";
          }
          if (fallbackMalId) markReferenceDeletedOnAni(kind, mediaId, fallbackMalId);
          return settings.syncDeletions ? "failed" : "skipped";
        }

        if (!aniCore.exists) {
          if (canSafeDelete(STORAGE.HISTORY_ANI_TO_MAL, kind, aniCore.malId, settings)) {
            const deleted = await malClient.remove(kind, aniCore.malId);
            if (deleted) {
              purgeReference(kind, aniCore.mediaId, aniCore.malId);
              addLog(`Deleted MAL ${kind} ${aniCore.malId} from pending AniList deletion`, "success");
              addDebug("PENDING_ANI_DELETE_TO_MAL", { kind, malId: aniCore.malId, mediaId });
              return "deleted";
            }
            return "failed";
          }
          markReferenceDeletedOnAni(kind, aniCore.mediaId, aniCore.malId);
          addLog(`Skipped MAL delete for ${kind} ${aniCore.malId}: safe deletion history missing`, "warn");
          return settings.syncDeletions ? "failed" : "skipped";
        }

        const target = toMalCoreFromAniCore(aniCore);
        const fp = coreFingerprint(target);
        if (isRecent(kind, target.malId, fp)) {
          confirmReferenceSynced(kind, aniCore, target);
          return "skipped";
        }

        let current: MalCoreEntry | undefined;
        if (kind === "ANIME") current = await malClient.getAnimeStatus(target.malId);
        else current = await malClient.getMangaStatus(target.malId);

        if (!needsMalUpdate(current, target)) {
          confirmReferenceSynced(kind, aniCore, current || target);
          addDebug("PENDING_ANI_TO_MAL_SKIPPED", { kind, malId: target.malId, reason: "already synced" });
          return "skipped";
        }

        const ok = await pushAniToMal(kind, aniCore);
        if (!ok) return "failed";

        addLog(`AniList -> MAL ${kind} ${target.malId}`, "success");
        addDebug("PENDING_ANI_TO_MAL", { kind, mediaId, malId: target.malId, target, current });
        return "changed";
      } catch (err) {
        addLog(`AniList -> MAL ${kind} ${mediaId} skipped: ${toErrorMessage(err)}`, "warn");
        addDebug("PENDING_ANI_TO_MAL_ERROR", { kind, mediaId, error: toErrorMessage(err) });
        return "failed";
      }
    }

    async function syncAniToMalBatch(kind: MediaKind): Promise<SyncBatchResult> {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return makeResult();
      if (kind === "MANGA" && !settings.includeManga) return makeResult();

      const queue = loadPendingQueue();
      const pending = Object.values(queue).filter((item) => (item.kind || inferKindByMediaId(item.mediaId)) === kind);
      const result = makeResult();
      if (!pending.length) {
        addLog(`Pending ANI->MAL ${kind}: no queued changes`, "info");
        return result;
      }

      let processed = 0;
      for (const item of pending) {
        if (shouldCancelSync.get()) break;
        processed += 1;
        setProgress(processed, pending.length, `Pending ANI->MAL ${kind} ${item.mediaId}`);

        const outcome = await syncSingleAniToMal(kind, item.mediaId, item.malId);
        if (outcome === "changed") result.changed += 1;
        else if (outcome === "deleted") result.deleted += 1;
        else if (outcome === "failed") result.failed += 1;
        else result.skipped += 1;

        if (outcome !== "failed") removePending(item.mediaId);
      }

      addLog(`Pending ANI->MAL ${kind}: C:${result.changed} D:${result.deleted} F:${result.failed} S:${result.skipped}`, result.failed ? "warn" : "success");
      return result;
    }

    async function syncMalToAniBatch(kind: MediaKind): Promise<SyncBatchResult> {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return makeResult();
      if (kind === "MANGA" && !settings.includeManga) return makeResult();

      const aniMap = aniListAdapter.getCollectionMap(kind);
      const malMap = await buildMalMap(kind);
      const result = makeResult();
      if (!malMap) {
        addLog(`MAL->ANI ${kind}: skipped because MAL list could not be fetched`, "warn");
        return makeResult({ failed: 1 });
      }
      reconcileReferenceIndex(kind, aniMap, malMap);

      let processed = 0;
      for (const [malId, malCore] of malMap.entries()) {
        if (shouldCancelSync.get()) break;
        processed += 1;
        setProgress(processed, malMap.size, `MAL->ANI ${kind} ${malId}`);

        try {
          const currentAni = aniMap.get(malId);
          const patch = toAniPatchFromMalCore(malCore);
          if (!needsAniUpdate(currentAni, patch)) {
            result.skipped += 1;
            continue;
          }

          const ok = pushMalToAni(kind, malCore, currentAni);
          if (ok) result.changed += 1;
          else result.failed += 1;
        } catch (err) {
          result.failed += 1;
          addLog(`MAL->ANI ${kind} ${malId} skipped: ${toErrorMessage(err)}`, "warn");
          addDebug("MAL_TO_ANI_ENTRY_ERROR", { kind, malId, error: toErrorMessage(err) });
        }
      }

      if (settings.syncDeletions) {
        for (const [malId, aniCore] of aniMap.entries()) {
          if (shouldCancelSync.get()) break;
          if (malMap.has(malId)) continue;
          if (!canSafeDelete(STORAGE.HISTORY_MAL_TO_ANI, kind, malId, settings)) {
            result.skipped += 1;
            addLog(`Skipped AniList delete for ${kind} ${malId}: safe deletion history missing`, "warn");
            continue;
          }
          if (aniListAdapter.deleteEntry(aniCore.mediaId)) {
            result.deleted += 1;
            purgeReference(kind, aniCore.mediaId, malId);
          } else result.failed += 1;
        }
      }

      saveHistorySet(STORAGE.HISTORY_MAL_TO_ANI, kind, new Set(malMap.keys()));
      aniListAdapter.refresh(kind);
      addLog(`Batch MAL->ANI ${kind}: C:${result.changed} D:${result.deleted} F:${result.failed} S:${result.skipped}`, result.failed ? "warn" : "success");
      return result;
    }

    async function syncBidirectionalBatch(kind: MediaKind): Promise<SyncBatchResult> {
      const settings = loadSettings();
      if (kind === "ANIME" && !settings.includeAnime) return makeResult();
      if (kind === "MANGA" && !settings.includeManga) return makeResult();

      const aniMap = aniListAdapter.getCollectionMap(kind);
      const malMap = await buildMalMap(kind);
      const result = makeResult();
      if (!malMap) {
        addLog(`BIDIRECTIONAL ${kind}: skipped because MAL list could not be fetched`, "warn");
        return makeResult({ failed: 1 });
      }
      reconcileReferenceIndex(kind, aniMap, malMap);

      const shadow = loadShadow(kind);
      const ids = Array.from(new Set<number>([
        ...Array.from(aniMap.keys()),
        ...Array.from(malMap.keys()),
      ]));

      let processed = 0;
      for (const malId of ids) {
        if (shouldCancelSync.get()) break;
        processed += 1;
        setProgress(processed, ids.length, `BIDIRECTIONAL ${kind} ${malId}`);

        try {
          const aniCore = aniMap.get(malId);
          const malCore = malMap.get(malId);
          const prev = shadow[String(malId)];

          if (aniCore && malCore) {
            const aniTarget = toMalCoreFromAniCore(aniCore);
            const aniFp = coreFingerprint(aniTarget);
            const malFp = coreFingerprint(malCore);

            if (aniFp === malFp) {
              shadow[String(malId)] = { ani: aniFp, mal: malFp, winner: "NONE", at: Date.now() };
              result.skipped += 1;
              continue;
            }

            const aniChanged = !prev || prev.ani !== aniFp;
            const malChanged = !prev || prev.mal !== malFp;
            let winner: "ANI" | "MAL" | "SKIP";

            if (prev && aniChanged && !malChanged) winner = "ANI";
            else if (prev && malChanged && !aniChanged) winner = "MAL";
            else {
              winner = resolveConflictWinner(settings, aniTarget, malCore);
              result.conflicts += 1;
              addLog(`Conflict ${kind} ${malId}: ${winner}`, winner === "SKIP" ? "warn" : "info");
              addDebug("BIDIRECTIONAL_CONFLICT", { kind, malId, policy: settings.conflictPolicy, winner, aniTarget, malCore, prev });
            }

            if (winner === "SKIP") {
              result.skipped += 1;
              continue;
            }

            if (winner === "ANI") {
              const ok = await pushAniToMal(kind, aniCore);
              if (ok) {
                result.changed += 1;
                shadow[String(malId)] = { ani: aniFp, mal: aniFp, winner: "ANI", at: Date.now() };
              } else result.failed += 1;
            } else {
              const ok = pushMalToAni(kind, malCore, aniCore);
              if (ok) {
                result.changed += 1;
                shadow[String(malId)] = { ani: malFp, mal: malFp, winner: "MAL", at: Date.now() };
              } else result.failed += 1;
            }
            continue;
          }

          if (aniCore && !malCore) {
            const aniTarget = toMalCoreFromAniCore(aniCore);
            const fp = coreFingerprint(aniTarget);
            if (settings.syncDeletions && (prev || !settings.safeDeletions)) {
              const ok = aniListAdapter.deleteEntry(aniCore.mediaId);
              if (ok) {
                result.deleted += 1;
                delete shadow[String(malId)];
                purgeReference(kind, aniCore.mediaId, malId);
              } else result.failed += 1;
            } else {
              const ok = await pushAniToMal(kind, aniCore);
              if (ok) {
                result.changed += 1;
                shadow[String(malId)] = { ani: fp, mal: fp, winner: "ANI", at: Date.now() };
              } else result.failed += 1;
            }
            continue;
          }

          if (!aniCore && malCore) {
            const fp = coreFingerprint(malCore);
            if (settings.syncDeletions && (prev || !settings.safeDeletions)) {
              const ok = await malClient.remove(kind, malId);
              if (ok) {
                result.deleted += 1;
                delete shadow[String(malId)];
                purgeReference(kind, undefined, malId);
              } else result.failed += 1;
            } else {
              const ok = pushMalToAni(kind, malCore);
              if (ok) {
                result.changed += 1;
                shadow[String(malId)] = { ani: fp, mal: fp, winner: "MAL", at: Date.now() };
              } else result.failed += 1;
            }
          }
        } catch (err) {
          result.failed += 1;
          addLog(`BIDIRECTIONAL ${kind} ${malId} skipped: ${toErrorMessage(err)}`, "warn");
          addDebug("BIDIRECTIONAL_ENTRY_ERROR", { kind, malId, error: toErrorMessage(err) });
        }
      }

      saveShadow(kind, shadow);
      saveHistorySet(STORAGE.HISTORY_ANI_TO_MAL, kind, new Set(aniMap.keys()));
      saveHistorySet(STORAGE.HISTORY_MAL_TO_ANI, kind, new Set(malMap.keys()));
      aniListAdapter.refresh(kind);
      addLog(`BIDIRECTIONAL ${kind}: C:${result.changed} D:${result.deleted} F:${result.failed} S:${result.skipped} Conf:${result.conflicts}`, result.failed ? "warn" : "success");
      return result;
    }

    async function runSync(mode: SyncMode) {
      if (isSyncing.get()) {
        ctx.toast.info("A sync is already running");
        return;
      }
      isSyncing.set(true);
      shouldCancelSync.set(false);
      activeSyncMode.set(mode);
      resetProgress(`Starting ${mode}`);
      const pendingAtStart = pendingCount();

      try {
        statusText.set(`Sync ${mode} in progress...`);
        lastSyncSummary.set({
          intent: "info",
          title: "Syncing…",
          detail: `Running ${mode}. This may take a few seconds.`,
        });
        ctx.toast.info(`Starting sync ${mode}`);
        await tokenManager.refreshIfNeeded();

        let aniToMalAnime = makeResult();
        let aniToMalManga = makeResult();
        let malToAniAnime = makeResult();
        let malToAniManga = makeResult();
        let bidirAnime = makeResult();
        let bidirManga = makeResult();

        if (mode === "ANI_TO_MAL") {
          aniToMalAnime = await syncAniToMalBatch("ANIME");
          aniToMalManga = await syncAniToMalBatch("MANGA");
        }
        if (mode === "MAL_TO_ANI") {
          malToAniAnime = await syncMalToAniBatch("ANIME");
          malToAniManga = await syncMalToAniBatch("MANGA");
        }
        if (mode === "BIDIRECTIONAL") {
          bidirAnime = await syncBidirectionalBatch("ANIME");
          bidirManga = await syncBidirectionalBatch("MANGA");
        }

        const total = mergeResults(aniToMalAnime, aniToMalManga, malToAniAnime, malToAniManga, bidirAnime, bidirManga);
        const totalChanges = total.changed + total.deleted;
        if (mode === "BIDIRECTIONAL" && total.failed === 0) {
          savePendingQueue({});
        }
        const noPendingAniToMal = mode === "ANI_TO_MAL" && pendingAtStart === 0;
        const summary = mode === "BIDIRECTIONAL"
          ? `BIDIR A:${bidirAnime.changed}/${bidirAnime.deleted}/${bidirAnime.failed} M:${bidirManga.changed}/${bidirManga.deleted}/${bidirManga.failed} Conf:${bidirAnime.conflicts + bidirManga.conflicts}`
          : `ANI→MAL A:${aniToMalAnime.changed}/${aniToMalAnime.deleted}/${aniToMalAnime.failed} M:${aniToMalManga.changed}/${aniToMalManga.deleted}/${aniToMalManga.failed} | MAL→ANI A:${malToAniAnime.changed}/${malToAniAnime.deleted}/${malToAniAnime.failed} M:${malToAniManga.changed}/${malToAniManga.deleted}/${malToAniManga.failed}`;

        lastRun.set(new Date().toISOString());
        lastSyncSummary.set({
          intent: noPendingAniToMal ? "info" : (shouldCancelSync.get() ? "warning" : (total.failed ? "warning" : "success")),
          title: noPendingAniToMal ? "No pending AniList changes" : (shouldCancelSync.get() ? `Sync ${mode} cancelled` : `Sync ${mode} completed`),
          detail: noPendingAniToMal
            ? "ANI_TO_MAL now only pushes queued Seanime events. Use BIDIRECTIONAL for a full reconciliation."
            : `${summary}. Changes/deletions: ${totalChanges}. Failed: ${total.failed}. Pending queue: ${pendingCount()}`,
        });
        if (noPendingAniToMal) addLog("ANI_TO_MAL skipped: no pending queued changes", "info");
        else addLog(`Sync ${mode} completed | ${summary}`, total.failed ? "warn" : "success");
        if (noPendingAniToMal) ctx.toast.info("No pending AniList changes to push");
        else ctx.toast.success(`Sync completed (${totalChanges} changes/deletions, ${total.failed} failed)`);
      } catch (err) {
        const raw = toErrorMessage(err);
        const explained = explainSyncError(raw);
        lastSyncSummary.set({
          intent: "alert",
          title: `Sync ${mode} failed`,
          detail: explained,
        });
        addLog(`Sync error: ${explained}`, "error");
        ctx.toast.error(`Sync failed: ${explained}`);
      } finally {
        isSyncing.set(false);
        activeSyncMode.set(null);
        if (!shouldCancelSync.get()) resetProgress("Idle");
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

    async function handlePostUpdate(mediaId?: number, event?: string) {
      const settings = loadSettings();
      if (!settings.liveSync) return;
      if (isSyncing.get()) return;
      if (!mediaId) return;
      if (event === "delete" && !settings.syncDeletions) return;

      try {
        await tokenManager.refreshIfNeeded();
        const kind = inferKindByMediaId(mediaId);
        if (!kind) return;
        const outcome = await syncSingleAniToMal(kind, mediaId);
        if (outcome !== "failed") removePending(mediaId);
      } catch (err) {
        addLog(`Live sync error: ${(err as Error).message}`, "warn");
      }
    }

    function configurePolling() {
      const settings = loadSettings();
      if (stopPollingTimer) {
        stopPollingTimer();
        stopPollingTimer = undefined;
      }

      if (!settings.pollMalEnabled) {
        addLog("MAL polling disabled", "info");
        return;
      }

      const minutes = clamp(5, 60, settings.pollEveryMinutes);
      const intervalMs = minutes * 60 * 1000;
      stopPollingTimer = ctx.setInterval(() => {
        if (isSyncing.get()) return;
        void runSync("MAL_TO_ANI");
      }, intervalMs);
      addLog(`MAL polling active every ${minutes} min`, "info");
    }

    migrateSettingsIfNeeded();

    ctx.registerEventHandler("save-config", () => {
      $storage.set(STORAGE.CLIENT_ID, clientIdRef.current || "");
      $storage.set(STORAGE.CLIENT_SECRET, clientSecretRef.current || "");
      settingsFeedback.set("Configuration saved ✅");
      addLog("MAL config saved", "success");
    });

    ctx.registerEventHandler("generate-verifier", () => {
      const verifier = generateCodeVerifier();
      $storage.set(STORAGE.PKCE_VERIFIER, verifier);
      settingsFeedback.set("Code verifier generated ✅");
      addLog("PKCE verifier generated", "success");
    });

    ctx.registerEventHandler("exchange-code", () => {
      void (async () => {
        try {
          await tokenManager.exchangeCode(authCodeRef.current || "");
          authFeedback.set("Connected to MAL ✅");
          addLog("MAL authentication succeeded", "success");
        } catch (err) {
          authFeedback.set(`Error: ${(err as Error).message}`);
          addLog(`MAL auth failed: ${(err as Error).message}`, "error");
        }
      })();
    });

    ctx.registerEventHandler("save-preferences", () => {
      saveSettingsFromRefs();
      configurePolling();
      settingsFeedback.set("Preferences saved ✅");
      addLog("Preferences saved", "success");
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

    ctx.registerEventHandler("cancel-sync", () => {
      shouldCancelSync.set(true);
      addLog("Cancelling sync after current entry...", "warn");
    });

    ctx.registerEventHandler("clear-logs", () => {
      logs.set([]);
      statusText.set("Logs cleared");
    });

    ctx.registerEventHandler("clear-debug", () => {
      debugLogs.set([]);
      addLog("Debug log cleared", "info");
    });

    ctx.registerEventHandler("clear-pending", () => {
      savePendingQueue({});
      addLog("Pending AniList -> MAL queue cleared", "warn");
    });

    $store.watch<{ mediaId?: number; event?: string; at?: number }>(POST_UPDATE_SIGNAL_KEY, (payload) => {
      queuePendingAniToMal(payload?.mediaId, payload?.event);
      void handlePostUpdate(payload?.mediaId, payload?.event);
    });

    configurePolling();

    const tray = ctx.newTray({
      iconUrl: ICON_URL,
      withContent: true,
      width: "560px",
      minHeight: "520px",
    });

    tray.render(() => {
      const authUrl = buildAuthUrl();
      const currentLogs = logs.get();
      const currentDebugLogs = debugLogs.get();
      const summary = lastSyncSummary.get();
      const syncing = isSyncing.get();
      const activeMode = activeSyncMode.get();
      const authOk = isAuthenticated.get();
      const progress = syncProgress.get();
      const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
      const queued = pendingCount();
      const refs = referenceCount();
      const pollEvery = clamp(5, 60, asNumber(pollEveryMinutesRef.current, DEFAULT_SETTINGS.pollEveryMinutes));

      return tray.stack([
        tray.css(`
          .malsync-shell { padding: 12px; overflow-x: hidden; box-sizing: border-box; width: 100%; }
          .malsync-card { border: 1px solid hsl(var(--border)); border-radius: 14px; padding: 14px; background: hsl(var(--background)); overflow-x: hidden; box-sizing: border-box; width: 100%; }
          .malsync-muted { font-size: 12px; opacity: 0.75; line-height: 1.45; white-space: normal; }
          .malsync-section-title { font-weight: 650; font-size: 13px; margin-top: 0; }
          .malsync-full { width: 100%; box-sizing: border-box; }
          .malsync-progress { width: 100%; height: 8px; border-radius: 999px; background: hsl(var(--muted)); overflow: hidden; }
          .malsync-progress-fill { height: 100%; border-radius: 999px; background: hsl(var(--primary)); }
        `),
        tray.div([
          tray.flex([
            tray.stack([
              tray.text("FullMALSync", { style: { fontWeight: "700", fontSize: "17px" } }),
              tray.text("AniList ↔ MyAnimeList · Anime + Manga", { className: "malsync-muted" }),
            ], { gap: 1 }),
            tray.badge(syncing ? `Sync ${activeMode || ""}` : (authOk ? "MAL connected" : "MAL disconnected"), {
              intent: syncing ? "info" : (authOk ? "success" : "warning"),
              size: "md",
            }),
          ], { gap: 2, style: { alignItems: "center", justifyContent: "space-between" } }),
          tray.tabs([
            tray.tabsList([
              tray.tabsTrigger(tray.text("Panel"), { value: "panel" }),
              tray.tabsTrigger(tray.text("Config"), { value: "config" }),
              tray.tabsTrigger(tray.text("Logs"), { value: "logs" }),
              tray.tabsTrigger(tray.text("Debug"), { value: "debug" }),
            ], { style: { marginTop: "10px", marginBottom: "8px", gap: "8px", width: "100%", overflowX: "hidden" } }),

            tray.tabsContent([
              tray.stack([
                tray.alert({
                  title: summary.title,
                  description: summary.detail,
                  intent: summary.intent,
                }),
                tray.stack([
                  tray.text(`Status: ${statusText.get()}`, { className: "malsync-muted" }),
                  tray.flex([
                    tray.badge(`Polling: ${pollEnabledRef.current ? `ON (${pollEvery}m)` : "OFF"}`, {
                      intent: pollEnabledRef.current ? "info" : "gray",
                      size: "sm",
                    }),
                    tray.badge(`Last: ${lastRun.get()}`, { intent: "gray", size: "sm" }),
                    tray.badge(`Pending: ${queued}`, { intent: queued ? "warning" : "gray", size: "sm" }),
                    tray.badge(`Refs: ${refs}`, { intent: refs ? "info" : "gray", size: "sm" }),
                  ], { gap: 2, style: { flexWrap: "wrap" } }),
                  syncing ? tray.stack([
                    tray.text(`${progress.label} · ${progress.current}/${progress.total || "?"} (${progressPct}%)`, { className: "malsync-muted" }),
                    tray.div([
                      tray.div([], { className: "malsync-progress-fill", style: { width: `${progressPct}%` } }),
                    ], { className: "malsync-progress" }),
                  ], { gap: 1 }) : null,
                ].filter(Boolean as any), { gap: 2 }),
                tray.stack([
                  tray.button({
                    label: "Sync default mode",
                    onClick: "sync-default",
                    intent: "primary",
                    loading: syncing && modeRef.current === activeMode,
                    disabled: syncing,
                    style: { width: "100%" },
                  }),
                  tray.button({
                    label: "Push pending ANI → MAL",
                    onClick: "sync-ani-to-mal",
                    intent: "gray-subtle",
                    loading: syncing && activeMode === "ANI_TO_MAL",
                    disabled: syncing,
                    style: { width: "100%" },
                  }),
                  tray.button({
                    label: "MAL → ANI",
                    onClick: "sync-mal-to-ani",
                    intent: "gray-subtle",
                    loading: syncing && activeMode === "MAL_TO_ANI",
                    disabled: syncing,
                    style: { width: "100%" },
                  }),
                  syncing ? tray.button({
                    label: "Cancel after current entry",
                    onClick: "cancel-sync",
                    intent: "alert",
                    style: { width: "100%" },
                  }) : null,
                  queued ? tray.button({
                    label: "Clear pending queue",
                    onClick: "clear-pending",
                    intent: "gray-subtle",
                    disabled: syncing,
                    style: { width: "100%" },
                  }) : null,
                ].filter(Boolean as any), { gap: 3 }),
                tray.text("Tip: if you see 'context deadline exceeded', it is usually a temporary MAL timeout/rate limit.", {
                  className: "malsync-muted",
                }),
              ], { gap: 4 }),
            ], { value: "panel", style: { marginTop: "4px" } }),

            tray.tabsContent([
              tray.stack([
                tray.text("OAuth MyAnimeList", { className: "malsync-section-title" }),
                tray.input({ fieldRef: clientIdRef, label: "Client ID", placeholder: "MAL Client ID" }),
                tray.input({ fieldRef: clientSecretRef, label: "Client Secret", placeholder: "MAL Client Secret" }),
                tray.stack([
                  tray.button({ label: "Save config", onClick: "save-config", intent: "gray-subtle", style: { width: "100%" } }),
                  tray.button({ label: "Generate PKCE verifier", onClick: "generate-verifier", intent: "gray-subtle", style: { width: "100%" } }),
                ], { gap: 3 }),
                authUrl ? tray.anchor({
                  href: authUrl,
                  text: "Open MAL authorization",
                  target: "_blank",
                }) : tray.alert({
                  title: "Missing PKCE link",
                  description: "Save your Client ID and generate a verifier to enable the authorization link.",
                  intent: "warning",
                }),
                tray.input({ fieldRef: authCodeRef, label: "Auth code or callback URL", placeholder: "Paste the code or full callback URL" }),
                tray.button({
                  label: "Exchange code for token",
                  onClick: "exchange-code",
                  intent: "primary",
                  style: { width: "100%" },
                }),
                authFeedback.get() ? tray.alert({
                  title: "Authentication status",
                  description: authFeedback.get(),
                  intent: authFeedback.get().includes("✅") ? "success" : "info",
                }) : null,

                tray.text("Sync preferences", { className: "malsync-section-title" }),
                tray.select({
                  label: "Default mode",
                  fieldRef: modeRef,
                  options: [
                    { label: "BIDIRECTIONAL (full reconcile)", value: "BIDIRECTIONAL" },
                    { label: "ANI_TO_MAL (pending queue)", value: "ANI_TO_MAL" },
                    { label: "MAL_TO_ANI (full import)", value: "MAL_TO_ANI" },
                  ],
                }),
                tray.switch({ fieldRef: liveSyncRef, label: "Live sync AniList -> MAL via hooks" }),
                tray.checkbox({ fieldRef: includeAnimeRef, label: "Include Anime" }),
                tray.checkbox({ fieldRef: includeMangaRef, label: "Include Manga" }),
                tray.checkbox({ fieldRef: syncDeletionsRef, label: "Sync deletions (danger)" }),
                tray.checkbox({ fieldRef: safeDeletionsRef, label: "Safe deletion history" }),
                tray.select({
                  label: "Conflict policy",
                  fieldRef: conflictPolicyRef,
                  options: [
                    { label: "Most progress", value: "MOST_PROGRESS" },
                    { label: "AniList wins", value: "ANILIST_WINS" },
                    { label: "MAL wins", value: "MAL_WINS" },
                    { label: "Skip conflicts", value: "SKIP" },
                  ],
                }),
                tray.switch({ fieldRef: pollEnabledRef, label: "Polling MAL -> AniList" }),
                tray.input({ fieldRef: pollEveryMinutesRef, label: "Poll every X min (5-60)", placeholder: "15" }),
                tray.button({ label: "Save preferences", onClick: "save-preferences", intent: "gray-subtle", style: { width: "100%" } }),
                settingsFeedback.get() ? tray.text(settingsFeedback.get(), { className: "malsync-muted" }) : null,
              ].filter(Boolean as any), { gap: 4 }),
            ].filter(Boolean as any), { value: "config", style: { marginTop: "4px" } }),

            tray.tabsContent([
              tray.stack([
                tray.flex([
                  tray.text("Recent logs", { className: "malsync-section-title" }),
                  tray.button({ label: "Clear logs", onClick: "clear-logs", intent: "gray", size: "sm" }),
                ], { gap: 2, style: { justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" } }),
                tray.div([
                  tray.stack(
                    (currentLogs.length ? currentLogs : [{ at: nowHHMMSS(), type: "info", message: "No logs yet." } as LogEntry])
                      .slice(0, 40)
                      .map((log) => tray.text(`[${log.at}] ${log.type.toUpperCase()}: ${log.message}`, { className: "malsync-muted" })),
                    { gap: 1 },
                  ),
                ], {
                  style: {
                    maxHeight: "320px",
                    overflowY: "auto",
                    overflowX: "hidden",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                    padding: "12px",
                    boxSizing: "border-box",
                    width: "100%",
                  },
                }),
              ], { gap: 3 }),
            ], { value: "logs", style: { marginTop: "4px" } }),

            tray.tabsContent([
              tray.stack([
                tray.flex([
                  tray.text("Raw / debug log", { className: "malsync-section-title" }),
                  tray.button({ label: "Clear debug", onClick: "clear-debug", intent: "gray", size: "sm" }),
                ], { gap: 2, style: { justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" } }),
                tray.div([
                  tray.stack(
                    (currentDebugLogs.length ? currentDebugLogs : [{ at: nowHHMMSS(), action: "EMPTY", detail: "No debug entries yet." } as DebugEntry])
                      .slice(0, 80)
                      .map((entry) => tray.text(`[${entry.at}] ${entry.action}: ${entry.detail}`, { className: "malsync-muted", style: { fontFamily: "monospace" } })),
                    { gap: 1 },
                  ),
                ], {
                  style: {
                    maxHeight: "320px",
                    overflowY: "auto",
                    overflowX: "hidden",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "12px",
                    padding: "12px",
                    boxSizing: "border-box",
                    width: "100%",
                  },
                }),
              ], { gap: 3 }),
            ], { value: "debug", style: { marginTop: "4px" } }),
          ], { defaultValue: "panel" }),
        ].filter(Boolean as any), { className: "malsync-card" }),
      ], { gap: 3, className: "malsync-shell" });
    });

    addLog("Plugin loaded. Configure OAuth and run sync.", "info");
  });
}
