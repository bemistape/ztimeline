# Zodiac Timeline Website

Static website for browsing your Airtable timeline with:

- Chronological, date-grouped timeline rows
- Fast text/location/people/media filters
- Image thumbnails with enhanced modal viewer (zoom, rotate, fullscreen, open-original)
- Location record modals with conditional Google Maps embeds (when coordinates or map URL exist)
- Collapsible events grouped by `Beginning Date`
- Click-to-filter chips for `Location` and `People`
- Shareable URL state (filters + event/record deep links)
- Airtable record IDs suppressed in UI output
- Data freshness indicator from refresh metadata

## Project files

- `index.html`: page structure
- `styles.css`: responsive visual system
- `app.js`: CSV parser + rendering + filters + modal logic
- `data/events-timeline.csv`: timeline dataset consumed by the app
- `data/people-people-sync.csv`: people records used for modal drill-down
- `data/location-location-sync.csv`: location records used for modal drill-down
- `data/tags-tags-sync.csv`: tag records used for modal drill-down
- `data/elements-starter.csv`: starter schema+rows for an Airtable `Elements` content table
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

### Optional Google Maps key for embeds

Location embeds work without a key when latitude/longitude are present using a public `q=lat,lon` embed URL.
If you want Google Maps Embed API mode, set your key in either:

- `window.GOOGLE_MAPS_API` before `app.js` runs, or
- `<meta name="google-maps-api" content="YOUR_KEY_HERE" />` in `index.html`

## Manual refresh from Airtable

This refresh script refreshes Events, People, Location, and Tags CSVs from Airtable in one run. It caches image attachments into `data/media/`, and uncached attachments are omitted from exports (no Airtable fallback URLs are emitted).

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
- `data/media/*` (cached image attachments)

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

The workflow caches image attachments by default (`--cache-media-types image`) so image links on the site do not depend on expiring Airtable URLs. Uncached attachments are omitted.

PDF attachments are intentionally not rendered in the timeline UI.

## Security note

Do not put your Airtable API token in frontend files. Treat the token as compromised if it was shared in plain text and rotate it in Airtable.
