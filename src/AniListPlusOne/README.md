# AniList +1 Episode

Seanime plugin that adds a compact `+1` button on anime detail pages.

When clicked, it increments the AniList watched episode progress for the current anime by one and refreshes the anime collection.

## Behavior

- Uses Seanime's `ctx.action.newAnimePageButton` API.
- Uses AniList's `updateEntry` API so progress, status, start date, and completion date are updated together.
- Moves `Planning` entries to `Watching` and sets the start date to the day the button was clicked.
- Moves entries to `Completed` and sets the completed date when the increment reaches the known final episode.
- Does not add anime that are not already in the user's AniList list.
- Does not increment beyond the known total episode count.
