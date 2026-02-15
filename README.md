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
- `assets/zodiac-header.png`: header image asset
- `scripts/refresh_airtable_data.py`: fetches Airtable view + refreshes local dataset
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

This refresh script can cache attachment files into `data/media/` so the site no longer relies on temporary Airtable URLs.

1. Set environment variables (or copy from `.env.example`):

```bash
export AIRTABLE_API_TOKEN="your_token_here"
export AIRTABLE_BASE_ID="appyDwtN9iiA9sjEe"
export AIRTABLE_TABLE_ID="tblxd8PLtQOl1dRa7"
export AIRTABLE_VIEW_ID="viwUWtXt3UUxE6LOC"
```

2. Run refresh:

```bash
python3 scripts/refresh_airtable_data.py --prune-media
```

This updates:

- `data/events-timeline.csv`
- `data/refresh-metadata.json`
- `data/media/*` (cached attachments)

## Automated daily refresh (GitHub Actions)

Use `.github/workflows/refresh-airtable.yml`:

1. In your GitHub repo settings, add secret:
   - `AIRTABLE_API_TOKEN`
2. Add optional repo variables (if you want to override defaults):
   - `AIRTABLE_BASE_ID`
   - `AIRTABLE_TABLE_ID`
   - `AIRTABLE_VIEW_ID`
3. Enable GitHub Actions for the repo.

The workflow runs:

- On a daily schedule
- On demand with `workflow_dispatch`

To keep Action pushes reliable, the workflow runs refresh with `--no-cache-media`, so it commits only lightweight dataset files (instead of trying to push large binary attachment batches that can fail with HTTP 408 during `git push`).

## Security note

Do not put your Airtable API token in frontend files. Treat the token as compromised if it was shared in plain text and rotate it in Airtable.
