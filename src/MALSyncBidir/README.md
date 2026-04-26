# MALSync Bidir

Bidirectional **AniList ↔ MAL** synchronization for:

- Anime ✅
- Manga ✅ (`num_volumes_read` intentionally ignored)
- Pending AniList → MAL queue ✅
- Bidirectional conflict handling ✅
- Safe deletion history ✅
- Progress, cancel, and debug logs ✅
- Persistent AniList ↔ MAL reference index with tombstones ✅

Note: `ANI_TO_MAL` pushes queued Seanime events only. Use `BIDIRECTIONAL` for a full reconciliation.

`BIDIRECTIONAL` and `MAL_TO_ANI` rebuild/update the reference index. Seanime hooks then reuse that index for incremental AniList → MAL pushes.
