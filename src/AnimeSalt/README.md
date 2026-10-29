# AnimeSalt

Seanime online streaming provider. Supported players appear by name: **Ravok**,
**MegaPlay**, and legacy **AS CDN**. A host absent from an episode returns no
sources; selecting a host never disguises another host under its name. Old
`default` requests still use automatic fallback for compatibility.

Ravok/AS CDN streams can carry several audio tracks. The source label lists the
audio names actually present in the HLS master; use the player's audio selector
to choose a language. Sub mode includes available external subtitles. MegaPlay
embeds explicitly marked sub/dub are restricted to their matching mode.

Signed HLS URLs are checked before being offered. Invalid playlists, empty
responses and temporary player errors trigger one fresh resolution attempt.
Errors retain their messages in Seanime's logs. Season-qualified searches retry
the base series title because AnimeSalt groups multiple seasons on one page.

Some pages also embed **Abyss**. Its encrypted, segmented player is not supported
by this provider and is not presented as a playable direct source.

Validation:

```powershell
node --test tests/animesalt.test.cjs
node tests/animesalt.live.cjs http://localhost:43211
```

The live check uses Seanime's Playground and native fetch to test My Dress-Up
Darling seasons 1 and 2, including HLS master, variant, segment and subtitles.
