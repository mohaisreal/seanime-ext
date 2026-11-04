/// <reference path="../AniListPlusOne/plugin.d.ts" />
/// <reference path="../AniListPlusOne/app.d.ts" />
/// <reference path="../AniListPlusOne/core.d.ts" />
/// <reference path="./shared.d.ts" />

// Inspired by Kaktus' installed Custom Anime Metadata editor.
// Overrides are local to this plugin. No AniList mutations are performed.
type FieldKey = "titleRomaji" | "titleEnglish" | "titleNative" | "description"
    | "coverImage" | "bannerImage" | "format" | "status" | "chapters" | "volumes"
    | "meanScore" | "startDate" | "endDate" | "genres" | "synonyms";
type MetadataOverride = Partial<Record<FieldKey, string>>;
interface MetadataField {
    key: FieldKey;
    label: string;
    options?: { label: string; value: string }[];
    numeric?: boolean;
    date?: boolean;
    image?: boolean;
    textarea?: boolean;
    hint?: string;
}
interface OverrideStore {
    fields: MetadataField[];
    validate(values: MetadataOverride): MetadataOverride;
    load(): Record<number, MetadataOverride>;
    save(id: number, override: MetadataOverride | null): void;
    apply(media: $app.AL_BaseManga | undefined): void;
    applyCollection(collection: $app.AL_MangaCollection | undefined): void;
}

function init() {
    $shared.define("manga-metadata-overrides", () => {
        const STORAGE_KEY = "CUSTOM_MANGA_METADATA_V1";
        const choices = (values: string[]) => [{ label: "AniList (original)", value: "default" }, ...values.map(value => ({ label: value, value }))];
        const FIELDS: MetadataField[] = [
            { key: "titleRomaji", label: "Título (Romaji)" },
            { key: "titleEnglish", label: "Título (inglés)" },
            { key: "titleNative", label: "Título (nativo)" },
            { key: "description", label: "Sinopsis", textarea: true },
            { key: "coverImage", label: "URL de portada", image: true },
            { key: "bannerImage", label: "URL de banner", image: true },
            { key: "format", label: "Formato", options: choices(["MANGA", "ONE_SHOT", "NOVEL"]) },
            { key: "status", label: "Estado", options: choices(["FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"]) },
            { key: "chapters", label: "Capítulos", numeric: true },
            { key: "volumes", label: "Volúmenes", numeric: true },
            { key: "meanScore", label: "Puntuación media", numeric: true, hint: "0–100" },
            { key: "startDate", label: "Fecha de inicio", date: true, hint: "AAAA-MM-DD" },
            { key: "endDate", label: "Fecha de fin", date: true, hint: "AAAA-MM-DD" },
            { key: "genres", label: "Géneros", hint: "Separados por comas" },
            { key: "synonyms", label: "Títulos alternativos", hint: "Separados por comas" },
        ];

        function validateOverride(values: MetadataOverride): MetadataOverride {
            const result: MetadataOverride = {};
            for (const field of FIELDS) {
                const value = (values[field.key] ?? "").trim();
                if (!value || value === field.options?.[0].value) continue;
                if (field.options && !field.options.some(option => option.value === value)) throw new Error(`${field.label}: opción no válida.`);
                if (field.numeric && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error(`${field.label}: introduce un entero mayor o igual a 0.`);
                if (field.key === "meanScore" && Number(value) > 100) throw new Error("La puntuación debe estar entre 0 y 100.");
                if (field.date) {
                    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
                    const year = Number(match?.[1]), month = Number(match?.[2]), day = Number(match?.[3]);
                    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
                    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                    if (!match || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new Error(`${field.label}: introduce una fecha válida (AAAA-MM-DD).`);
                }
                if (field.image && !/^https?:\/\/[^\s]+$/i.test(value)) throw new Error(`${field.label}: usa una URL http o https.`);
                result[field.key] = value;
            }
            if (result.startDate && result.endDate && result.endDate < result.startDate) throw new Error("La fecha de fin debe ser igual o posterior a la de inicio.");
            return result;
        }

        function applyOverride(media: $app.AL_BaseManga | undefined, override: MetadataOverride | undefined): void {
            if (!media || !override) return;
            const title = media.title ?? (media.title = {});
            // Resolve the preferred language before changing any of its original titles.
            const preferred = (["romaji", "english", "native"] as const).find(key => title[key] != null && title[key] === title.userPreferred);
            if (override.titleRomaji) title.romaji = override.titleRomaji;
            if (override.titleEnglish) title.english = override.titleEnglish;
            if (override.titleNative) title.native = override.titleNative;
            if (preferred) title.userPreferred = title[preferred];
            else if (!title.userPreferred) title.userPreferred = title.romaji || title.english || title.native;
            if (override.description) media.description = override.description;
            if (override.bannerImage) media.bannerImage = override.bannerImage;
            if (override.coverImage) media.coverImage = { ...media.coverImage, medium: override.coverImage, large: override.coverImage, extraLarge: override.coverImage };
            if (override.format) media.format = override.format as $app.AL_MediaFormat;
            if (override.status) media.status = override.status as $app.AL_MediaStatus;
            for (const key of ["chapters", "volumes", "meanScore"] as const) if (override[key] !== undefined) media[key] = Number(override[key]);
            for (const key of ["startDate", "endDate"] as const) {
                if (!override[key]) continue;
                const [year, month, day] = override[key]!.split("-").map(Number);
                media[key] = { year, month, day };
            }
            for (const key of ["genres", "synonyms"] as const) if (override[key]) media[key] = override[key]!.split(",").map(item => item.trim()).filter(Boolean);
        }


        const load = () => $storage.get<Record<number, MetadataOverride>>(STORAGE_KEY) ?? {};
        return {
            fields: FIELDS,
            validate: validateOverride,
            load,
            save(id: number, override: MetadataOverride | null) {
                const all = load();
                if (override && Object.keys(override).length) all[id] = override;
                else delete all[id];
                $storage.set(STORAGE_KEY, all);
            },
            apply(media: $app.AL_BaseManga | undefined) { if (media) applyOverride(media, load()[media.id]); },
            applyCollection(collection: $app.AL_MangaCollection | undefined) {
                const all = load();
                for (const list of collection?.MediaListCollection?.lists ?? []) {
                    for (const entry of list.entries ?? []) if (entry.media) applyOverride(entry.media, all[entry.media.id]);
                }
            },
        };
    });
    $app.onGetManga(e => { $shared.use<OverrideStore>("manga-metadata-overrides").apply(e.manga); e.next(); });
    $app.onGetMangaCollection(e => { $shared.use<OverrideStore>("manga-metadata-overrides").applyCollection(e.mangaCollection); e.next(); });
    $app.onGetRawMangaCollection(e => { $shared.use<OverrideStore>("manga-metadata-overrides").applyCollection(e.mangaCollection); e.next(); });
    $app.onGetCachedMangaCollection(e => { $shared.use<OverrideStore>("manga-metadata-overrides").applyCollection(e.mangaCollection); e.next(); });
    $app.onGetCachedRawMangaCollection(e => { $shared.use<OverrideStore>("manga-metadata-overrides").applyCollection(e.mangaCollection); e.next(); });
    $app.onMangaEntryRequested(e => { $shared.use<OverrideStore>("manga-metadata-overrides").applyCollection(e.mangaCollection); e.next(); });
    $app.onMangaEntry(e => { $shared.use<OverrideStore>("manga-metadata-overrides").apply(e.entry?.media); e.next(); });
    $app.onMangaLibraryCollectionRequested(e => { $shared.use<OverrideStore>("manga-metadata-overrides").applyCollection(e.mangaCollection); e.next(); });
    $app.onMangaLibraryCollection(e => {
        for (const list of e.libraryCollection?.lists ?? []) for (const entry of list.entries ?? []) $shared.use<OverrideStore>("manga-metadata-overrides").apply(entry.media);
        e.next();
    });

    $ui.register(ctx => {
        const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='12' fill='%2314b8a6'/%3E%3Cpath d='M10 12h12v25H10zm16 0h12v25H26z' fill='none' stroke='white' stroke-width='3'/%3E%3Cpath d='M15 19h3m-3 6h3m13-6h3m-3 6h3' stroke='white' stroke-width='2'/%3E%3C/svg%3E";
        const store = () => $shared.use<OverrideStore>("manga-metadata-overrides");
        const FIELDS = store().fields;
        const tray = ctx.newTray({ iconUrl: ICON, withContent: true, width: "36rem" });
        const current = ctx.state<$app.AL_BaseManga | null>(null);
        const refs = Object.fromEntries(FIELDS.map(field => [field.key, ctx.fieldRef<string>("")])) as Record<FieldKey, ReturnType<typeof ctx.fieldRef<string>>>;
        function fill(override: MetadataOverride) {
            for (const field of FIELDS) refs[field.key].setValue(override[field.key] ?? field.options?.[0].value ?? "");
        }
        function persist(id: number, override: MetadataOverride | null) {
            store().save(id, override);
            // Platform hooks can mutate cached objects. Clear them so removing an override restores originals.
            $anilist.clearCache();
            $anilist.refreshMangaCollection();
            $app.invalidateClientQuery(["MANGA-get-manga-entry", "MANGA-get-manga-entry-details", "MANGA-get-manga-collection", "MANGA-get-anilist-manga-collection", "MANGA-get-raw-anilist-manga-collection"]);
        }
        tray.render(() => {
            const media = current.get();
            if (!media) return tray.text("Abre una ficha de Manga y pulsa Editar metadata.", { className: "p-4 text-sm" });
            return tray.stack([
                tray.text("METADATA DE MANGA", { className: "text-xs font-semibold text-[--muted]" }),
                tray.text(media.title?.userPreferred || media.title?.romaji || `Manga ${media.id}`, { className: "text-xl font-bold line-clamp-2" }),
                tray.text("Cambios locales a Seanime. Deja un campo vacío para usar AniList.", { className: "text-sm text-[--muted]" }),
                tray.div(FIELDS.map(field => field.options
                    ? tray.select(field.label, { fieldRef: refs[field.key], options: field.options })
                    : tray.input({ label: field.label, fieldRef: refs[field.key], textarea: field.textarea ?? false, placeholder: field.hint || "Usar valor de AniList" })
                ), { className: "space-y-3 overflow-y-auto pr-2", style: { maxHeight: "min(36vh, 18rem)" } }),
                tray.flex([
                    tray.button("Restaurar AniList", { intent: "alert", onClick: ctx.eventHandler("reset-manga-metadata", () => {
                        try {
                            persist(media.id, null);
                            fill({});
                            tray.close();
                            ctx.toast.success("Metadata restaurada a los valores de AniList.");
                        } catch (error) { ctx.toast.error((error as Error).message); }
                    }) }),
                    tray.button("Guardar", { intent: "primary", onClick: ctx.eventHandler("save-manga-metadata", () => {
                        try {
                            const values: MetadataOverride = {};
                            for (const field of FIELDS) values[field.key] = refs[field.key].current;
                            persist(media.id, store().validate(values));
                            tray.close();
                            ctx.toast.success("Metadata de Manga guardada.");
                        } catch (error) { ctx.toast.error((error as Error).message); }
                    }) }),
                ], { className: "justify-end gap-2 pt-2" }),
            ], { className: "p-3 space-y-3" });
        });
        const action = ctx.action.newMangaPageButton({ label: "Editar metadata", tooltipText: "Personaliza la metadata local de este Manga" });
        action.onClick(({ media }) => {
            current.set(media);
            fill(store().load()[media.id] ?? {});
            tray.open();
        });
        action.mount();
    });
}
