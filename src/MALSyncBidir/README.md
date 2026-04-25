# MALSync Bidir

Bidirectional **AniList ↔ MAL** synchronization for:

- Anime ✅
- Manga ✅ (`num_volumes_read` intentionally ignored)
- Pending AniList → MAL queue ✅
- Bidirectional conflict handling ✅
- Safe deletion history ✅
- Progress, cancel, and debug logs ✅

Note: `ANI_TO_MAL` pushes queued Seanime events only. Use `BIDIRECTIONAL` for a full reconciliation.
