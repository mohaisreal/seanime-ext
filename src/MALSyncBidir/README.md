# FullMALSync

AniList and MyAnimeList synchronization for:

- Anime ✅
- Manga ✅ (`num_volumes_read` intentionally ignored)
- Full AniList → MAL sync ✅
- MAL → AniList import ✅
- Pending AniList → MAL live queue ✅
- Safe deletion history ✅
- Progress, cancel, and debug logs ✅
- Persistent AniList ↔ MAL reference index with tombstones ✅

`ANI_TO_MAL` now performs a full collection sync like the reference MALSync plugin, but it includes both Anime and Manga. It fetches each side once, builds in-memory maps, compares locally, then sends one MAL request per changed entry with throttled waits between writes.

`MAL_TO_ANI` remains available as a separate import mode. The old `BIDIRECTIONAL` UI option was removed to avoid aggressive AniList reconciliation and reduce AniList rate-limit pressure.

Seanime hooks still maintain the pending AniList → MAL queue for live updates. Live updates resolve Manga/Anime through the pending queue and persistent reference index before falling back to the AniList cache; a full `ANI_TO_MAL` run clears processed entries after successful writes or already-synced confirmation.
