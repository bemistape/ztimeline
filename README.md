# Zodiac Timeline Website

Static website for browsing your Airtable timeline with:

- Chronological, date-grouped timeline rows
- Fast text/location/people/media filters
- Image thumbnails with fullscreen modal viewer
- Collapsible events grouped by `Beginning Date`
- Click-to-filter chips for `Location` and `People`

## Project files

- `index.html`: page structure
- `styles.css`: responsive visual system
- `app.js`: CSV parser + rendering + filters + modal logic
- `data/events-timeline.csv`: timeline dataset consumed by the app
- `data/people-people-sync.csv`: people records used for modal drill-down
- `data/location-location-sync.csv`: location records used for modal drill-down
- `data/tags-tags-sync.csv`: tag records used for modal drill-down
- `assets/zodiac-header.png`: header image asset
- `scripts/refresh_airtable_data.py`: fetches Airtable views + refreshes local datasets
- `.github/workflows/refresh-airtable.yml`: optional daily and manual cloud refresh

## Run locally

Because the app fetches `data/events-timeline.csv`, open it through a local web server:

```bash
cd /Users/johnsmith/Documents/GitHub/ztimeline
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173`

## Manual refresh from Airtable

This refresh script refreshes Events, People, Location, and Tags CSVs from Airtable in one run. It can cache attachment files into `data/media/` so the site no longer relies on temporary Airtable URLs.

1. Set environment variables (or copy from `.env.example`):

```bash
export AIRTABLE_API_TOKEN="your_token_here"
export AIRTABLE_BASE_ID="appyDwtN9iiA9sjEe"
export AIRTABLE_TABLE_ID="tblxd8PLtQOl1dRa7"
export AIRTABLE_VIEW_ID="viwUWtXt3UUxE6LOC"
export AIRTABLE_PEOPLE_TABLE_ID="tblpcpi1xL4Kbajqv"
export AIRTABLE_PEOPLE_VIEW_ID="viwlBBAjb87ucn0ni"
export AIRTABLE_LOCATION_TABLE_ID="tbl5djS0HR8Ecg1OJ"
export AIRTABLE_LOCATION_VIEW_ID="viwbicx0kvh1UMRLB"
export AIRTABLE_TAGS_TABLE_ID="tbl369AkU0k8At9IV"
export AIRTABLE_TAGS_VIEW_ID="viwa1K5WgktgPYoO9"
export AIRTABLE_SYNC_MODE="delta"
```

2. Run refresh:

```bash
python3 scripts/refresh_airtable_data.py --sync-mode delta --prune-media --cache-media-types image
```

Use `--sync-mode full` when you want a complete rebuild.

This updates:

- `data/events-timeline.csv`
- `data/people-people-sync.csv`
- `data/location-location-sync.csv`
- `data/tags-tags-sync.csv`
- `data/refresh-metadata.json`
- `data/refresh-metadata-people.json`
- `data/refresh-metadata-location.json`
- `data/refresh-metadata-tags.json`
- `data/media/*` (cached attachments)

## Automated daily refresh (GitHub Actions)

Use `.github/workflows/refresh-airtable.yml`:

1. In your GitHub repo settings, add secret:
   - `AIRTABLE_API_TOKEN`
2. Add optional repo variables (if you want to override defaults):
   - `AIRTABLE_BASE_ID`
   - `AIRTABLE_TABLE_ID`
   - `AIRTABLE_VIEW_ID`
   - `AIRTABLE_PEOPLE_TABLE_ID`
   - `AIRTABLE_PEOPLE_VIEW_ID`
   - `AIRTABLE_LOCATION_TABLE_ID`
   - `AIRTABLE_LOCATION_VIEW_ID`
   - `AIRTABLE_TAGS_TABLE_ID`
   - `AIRTABLE_TAGS_VIEW_ID`
3. Enable GitHub Actions for the repo.

The workflow runs:

- Daily in `delta` mode (only changed/new records + unpublished removals)
- Weekly in `full` mode (full reconciliation, catches hard deletes)
- On demand with `workflow_dispatch`

The workflow now caches image attachments by default (`--cache-media-types image`) so image links on the site do not depend on expiring Airtable URLs.

Optional manual modes for `--cache-media-types`:

- `image` (workflow default)
- `pdf`
- `image,pdf`
- `file`
- empty string to cache all media types

## Security note

Do not put your Airtable API token in frontend files. Treat the token as compromised if it was shared in plain text and rotate it in Airtable.
