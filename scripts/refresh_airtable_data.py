#!/usr/bin/env python3
"""
Refresh timeline CSV data from Airtable and optionally cache attachment files locally.

Usage:
  AIRTABLE_API_TOKEN=... python3 scripts/refresh_airtable_data.py --prune-media
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_BASE_ID = "appyDwtN9iiA9sjEe"
DEFAULT_EVENTS_TABLE_ID = "tblxd8PLtQOl1dRa7"
DEFAULT_EVENTS_VIEW_ID = "viwUWtXt3UUxE6LOC"
DEFAULT_PEOPLE_TABLE_ID = "tblpcpi1xL4Kbajqv"
DEFAULT_PEOPLE_VIEW_ID = "viwlBBAjb87ucn0ni"
DEFAULT_LOCATION_TABLE_ID = "tbl5djS0HR8Ecg1OJ"
DEFAULT_LOCATION_VIEW_ID = "viwbicx0kvh1UMRLB"
DEFAULT_TAGS_TABLE_ID = "tbl369AkU0k8At9IV"
DEFAULT_TAGS_VIEW_ID = "viwa1K5WgktgPYoO9"
DEFAULT_ELEMENTS_TABLE_ID = "tblXJVRuDZHWaVtKj"
DEFAULT_ELEMENTS_VIEW_ID = "viwi5d6pT5HvblgON"
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif"}
BLOCKED_MEDIA_EXTENSIONS = {"tif", "tiff"}
PDF_EXTENSIONS = {"pdf"}
RECORD_ID_HEADER = "_Airtable Record ID"
MEDIA_REFERENCE_PATTERN = re.compile(r"data/media/([^),\s]+)")
LAST_MODIFIED_FIELD_CANDIDATES = [
    "Last Modified",
    "Last Modified Time",
    "Last Modified (All Fields)",
    "Last Modified (all fields)",
]
PUBLISHED_FIELD_CANDIDATES = ["Published", "Is Published", "Publish"]
ROOT_FALLBACK_CSV_BY_TARGET = {
    "events": "events-timeline.csv",
    "people": "people-people-sync.csv",
    "location": "location-location-sync.csv",
    "tags": "tags-tags-sync.csv",
    "elements": "elements-elements-sync.csv",
}

EVENTS_DEFAULT_HEADERS = [
    "Event Name",
    "Beginning Date",
    "Time",
    "Location",
    "Description",
    "Ending Date",
    "Related People & Groups",
    "Sources",
    "Document Images",
    "Events That Followed",
    "Related Documents",
    "Tags",
    "Event Year",
    "Event Month",
    "Weekday",
    "Origin Event",
    "Type",
    "Event Date & Time",
    "Event Timing",
    "Google Search",
    "Image Search",
    "PDFs",
    "Related Vehicles",
    "Created",
    "Time (AM/PM)",
    "Case Theories",
    "End Date/Time",
    "Images",
    "Related Document Summaries",
]


@dataclass(frozen=True)
class ExportTarget:
    name: str
    output_csv: Path
    metadata_path: Path
    table_id: str
    view_id: str
    preferred_headers: list[str]
    last_modified_field_candidates: list[str]
    published_field_candidates: list[str]


@dataclass(frozen=True)
class RefreshResult:
    mode: str
    record_count: int
    changed_records: int
    sync_cursor_utc: str
    published_field: str
    last_modified_field: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh Airtable exports for events, people, locations, tags, and optional elements."
    )
    parser.add_argument(
        "--output-csv",
        default="data/events-timeline.csv",
        help="Path to write refreshed events CSV.",
    )
    parser.add_argument(
        "--media-dir",
        default="data/media",
        help="Directory where attachment files are cached.",
    )
    parser.add_argument(
        "--metadata-path",
        default="data/refresh-metadata.json",
        help="Path to write events refresh metadata JSON.",
    )
    parser.add_argument(
        "--people-output-csv",
        default="data/people-people-sync.csv",
        help="Path to write refreshed people CSV.",
    )
    parser.add_argument(
        "--people-metadata-path",
        default="data/refresh-metadata-people.json",
        help="Path to write people refresh metadata JSON.",
    )
    parser.add_argument(
        "--location-output-csv",
        default="data/location-location-sync.csv",
        help="Path to write refreshed location CSV.",
    )
    parser.add_argument(
        "--location-metadata-path",
        default="data/refresh-metadata-location.json",
        help="Path to write location refresh metadata JSON.",
    )
    parser.add_argument(
        "--tags-output-csv",
        default="data/tags-tags-sync.csv",
        help="Path to write refreshed tags CSV.",
    )
    parser.add_argument(
        "--tags-metadata-path",
        default="data/refresh-metadata-tags.json",
        help="Path to write tags refresh metadata JSON.",
    )
    parser.add_argument(
        "--elements-output-csv",
        default="data/elements-elements-sync.csv",
        help="Path to write refreshed elements CSV.",
    )
    parser.add_argument(
        "--elements-metadata-path",
        default="data/refresh-metadata-elements.json",
        help="Path to write elements refresh metadata JSON.",
    )
    parser.add_argument(
        "--sync-mode",
        choices=["delta", "full"],
        default=env_or_default("AIRTABLE_SYNC_MODE", "delta"),
        help="Sync strategy. 'delta' updates only changed/new records when possible; 'full' rebuilds datasets.",
    )
    parser.add_argument(
        "--no-cache-media",
        action="store_true",
        help="Disable attachment caching. Uncached attachments are omitted from exported CSV fields.",
    )
    parser.add_argument(
        "--prune-media",
        action="store_true",
        help="Delete stale cached media files not referenced by refreshed records.",
    )
    parser.add_argument(
        "--cache-media-types",
        default=env_or_default("AIRTABLE_CACHE_MEDIA_TYPES", "image"),
        help=(
            "Comma-separated attachment types to cache locally (image,pdf,file). "
            "Default caches image attachments. Unselected attachment types are omitted."
        ),
    )
    parser.add_argument(
        "--max-media-downloads",
        type=int,
        default=None,
        help=(
            "Maximum number of new attachment files to download during this run. "
            "Existing cached files are still referenced. Default has no limit."
        ),
    )
    parser.add_argument(
        "--max-media-file-mb",
        type=int,
        default=int(env_or_default("AIRTABLE_MAX_MEDIA_FILE_MB", "95")),
        help=(
            "Maximum size (in MB) for a single downloaded attachment file. "
            "Larger files are skipped to avoid repository push limits."
        ),
    )
    parser.add_argument(
        "--base-id",
        default=env_or_default("AIRTABLE_BASE_ID", DEFAULT_BASE_ID),
        help="Airtable base id (default from env or built-in base).",
    )
    parser.add_argument(
        "--table-id",
        default=env_or_default("AIRTABLE_TABLE_ID", DEFAULT_EVENTS_TABLE_ID),
        help="Airtable events table id (default from env or built-in table).",
    )
    parser.add_argument(
        "--view-id",
        default=env_or_default("AIRTABLE_VIEW_ID", DEFAULT_EVENTS_VIEW_ID),
        help="Airtable events view id (default from env or built-in view).",
    )
    parser.add_argument(
        "--people-table-id",
        default=env_or_default("AIRTABLE_PEOPLE_TABLE_ID", DEFAULT_PEOPLE_TABLE_ID),
        help="Airtable people table id (default from env or built-in table).",
    )
    parser.add_argument(
        "--people-view-id",
        default=env_or_default("AIRTABLE_PEOPLE_VIEW_ID", DEFAULT_PEOPLE_VIEW_ID),
        help="Airtable people view id (default from env or built-in view).",
    )
    parser.add_argument(
        "--location-table-id",
        default=env_or_default("AIRTABLE_LOCATION_TABLE_ID", DEFAULT_LOCATION_TABLE_ID),
        help="Airtable location table id (default from env or built-in table).",
    )
    parser.add_argument(
        "--location-view-id",
        default=env_or_default("AIRTABLE_LOCATION_VIEW_ID", DEFAULT_LOCATION_VIEW_ID),
        help="Airtable location view id (default from env or built-in view).",
    )
    parser.add_argument(
        "--tags-table-id",
        default=env_or_default("AIRTABLE_TAGS_TABLE_ID", DEFAULT_TAGS_TABLE_ID),
        help="Airtable tags table id (default from env or built-in table).",
    )
    parser.add_argument(
        "--tags-view-id",
        default=env_or_default("AIRTABLE_TAGS_VIEW_ID", DEFAULT_TAGS_VIEW_ID),
        help="Airtable tags view id (default from env or built-in view).",
    )
    parser.add_argument(
        "--elements-table-id",
        default=env_or_default("AIRTABLE_ELEMENTS_TABLE_ID", DEFAULT_ELEMENTS_TABLE_ID),
        help=(
            "Airtable elements table id. Leave empty to skip Elements refresh. "
            "(default from env)"
        ),
    )
    parser.add_argument(
        "--elements-view-id",
        default=env_or_default("AIRTABLE_ELEMENTS_VIEW_ID", DEFAULT_ELEMENTS_VIEW_ID),
        help=(
            "Airtable elements view id. Leave empty to skip Elements refresh. "
            "(default from env)"
        ),
    )
    return parser.parse_args()


def env_or_default(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value if value else default


def main() -> int:
    args = parse_args()
    token = os.getenv("AIRTABLE_API_TOKEN", "").strip()
    if not token:
        print("Missing AIRTABLE_API_TOKEN.", file=sys.stderr)
        return 2

    media_dir = Path(args.media_dir)
    cache_media = not args.no_cache_media
    if args.max_media_downloads is not None and args.max_media_downloads < 0:
        print("--max-media-downloads must be zero or greater.", file=sys.stderr)
        return 2
    if args.max_media_file_mb <= 0:
        print("--max-media-file-mb must be greater than zero.", file=sys.stderr)
        return 2
    download_budget = {"remaining": args.max_media_downloads} if args.max_media_downloads is not None else None
    max_media_file_bytes = args.max_media_file_mb * 1024 * 1024
    try:
        cache_media_types = parse_cache_media_types(args.cache_media_types)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    media_dir.mkdir(parents=True, exist_ok=True)
    targets = [
        ExportTarget(
            name="events",
            output_csv=Path(args.output_csv),
            metadata_path=Path(args.metadata_path),
            table_id=args.table_id,
            view_id=args.view_id,
            preferred_headers=EVENTS_DEFAULT_HEADERS,
            last_modified_field_candidates=LAST_MODIFIED_FIELD_CANDIDATES,
            published_field_candidates=PUBLISHED_FIELD_CANDIDATES,
        ),
        ExportTarget(
            name="people",
            output_csv=Path(args.people_output_csv),
            metadata_path=Path(args.people_metadata_path),
            table_id=args.people_table_id,
            view_id=args.people_view_id,
            preferred_headers=[],
            last_modified_field_candidates=LAST_MODIFIED_FIELD_CANDIDATES,
            published_field_candidates=PUBLISHED_FIELD_CANDIDATES,
        ),
        ExportTarget(
            name="location",
            output_csv=Path(args.location_output_csv),
            metadata_path=Path(args.location_metadata_path),
            table_id=args.location_table_id,
            view_id=args.location_view_id,
            preferred_headers=[],
            last_modified_field_candidates=LAST_MODIFIED_FIELD_CANDIDATES,
            published_field_candidates=PUBLISHED_FIELD_CANDIDATES,
        ),
        ExportTarget(
            name="tags",
            output_csv=Path(args.tags_output_csv),
            metadata_path=Path(args.tags_metadata_path),
            table_id=args.tags_table_id,
            view_id=args.tags_view_id,
            preferred_headers=[],
            last_modified_field_candidates=LAST_MODIFIED_FIELD_CANDIDATES,
            published_field_candidates=PUBLISHED_FIELD_CANDIDATES,
        ),
    ]

    elements_table_id = normalize_text(args.elements_table_id)
    elements_view_id = normalize_text(args.elements_view_id)
    if elements_table_id and elements_view_id:
        targets.append(
            ExportTarget(
                name="elements",
                output_csv=Path(args.elements_output_csv),
                metadata_path=Path(args.elements_metadata_path),
                table_id=elements_table_id,
                view_id=elements_view_id,
                preferred_headers=[],
                last_modified_field_candidates=LAST_MODIFIED_FIELD_CANDIDATES,
                published_field_candidates=PUBLISHED_FIELD_CANDIDATES,
            )
        )
    elif elements_table_id or elements_view_id:
        print(
            "[elements] Skipping Elements refresh because table/view id is incomplete. "
            "Set both AIRTABLE_ELEMENTS_TABLE_ID and AIRTABLE_ELEMENTS_VIEW_ID."
        )
    else:
        print("[elements] Elements refresh disabled (no table/view ids configured).")

    used_media_files: set[str] = set()
    for target in targets:
        result = refresh_target(
            token=token,
            base_id=args.base_id,
            target=target,
            media_dir=media_dir,
            cache_media=cache_media,
            cache_media_types=cache_media_types,
            used_media_files=used_media_files,
            download_budget=download_budget,
            max_media_file_bytes=max_media_file_bytes,
            sync_mode=args.sync_mode,
        )
        print(
            f"[{target.name}] {result.mode} sync complete: "
            f"{result.record_count} records ({result.changed_records} changed)."
        )
        sync_root_fallback_csv(target)

    if cache_media and args.prune_media:
        prune_stale_media(media_dir, used_media_files)

    print("Refresh complete.")
    return 0


def refresh_target(
    *,
    token: str,
    base_id: str,
    target: ExportTarget,
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
    download_budget: dict[str, int] | None,
    max_media_file_bytes: int,
    sync_mode: str,
) -> RefreshResult:
    target.output_csv.parent.mkdir(parents=True, exist_ok=True)
    target.metadata_path.parent.mkdir(parents=True, exist_ok=True)

    previous_metadata = read_json_file(target.metadata_path)
    existing_headers, existing_rows_by_id = read_existing_rows_by_record_id(target.output_csv)

    if sync_mode == "delta":
        result = refresh_target_delta(
            token=token,
            base_id=base_id,
            target=target,
            media_dir=media_dir,
            cache_media=cache_media,
            cache_media_types=cache_media_types,
            used_media_files=used_media_files,
            download_budget=download_budget,
            max_media_file_bytes=max_media_file_bytes,
            previous_metadata=previous_metadata,
            existing_headers=existing_headers,
            existing_rows_by_id=existing_rows_by_id,
        )
        if result is not None:
            return result
        print(f"[{target.name}] Delta sync unavailable; falling back to full sync.")

    return refresh_target_full(
        token=token,
        base_id=base_id,
        target=target,
        media_dir=media_dir,
        cache_media=cache_media,
        cache_media_types=cache_media_types,
        used_media_files=used_media_files,
        download_budget=download_budget,
        max_media_file_bytes=max_media_file_bytes,
        previous_metadata=previous_metadata,
    )


def refresh_target_delta(
    *,
    token: str,
    base_id: str,
    target: ExportTarget,
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
    download_budget: dict[str, int] | None,
    max_media_file_bytes: int,
    previous_metadata: dict[str, Any],
    existing_headers: list[str],
    existing_rows_by_id: dict[str, dict[str, str]],
) -> RefreshResult | None:
    if not existing_rows_by_id or RECORD_ID_HEADER not in existing_headers:
        return None

    previous_cursor = normalize_text(previous_metadata.get("sync_cursor_utc"))
    if not previous_cursor:
        return None

    published_field = resolve_known_field_name(
        previous_metadata=previous_metadata,
        known_headers=existing_headers,
        candidates=target.published_field_candidates,
        metadata_key="published_field",
    )
    last_modified_field = resolve_known_field_name(
        previous_metadata=previous_metadata,
        known_headers=existing_headers,
        candidates=target.last_modified_field_candidates,
        metadata_key="last_modified_field",
    )

    if not last_modified_field:
        return None

    missing_cached_files = 0
    for row in existing_rows_by_id.values():
        row_references = extract_media_references_from_row(row)
        used_media_files.update(row_references)
        if not cache_media:
            continue
        for media_name in row_references:
            if not (media_dir / media_name).exists():
                missing_cached_files += 1

    if missing_cached_files:
        print(f"[{target.name}] Detected {missing_cached_files} missing cached media files.")
        return None

    delta_formula = build_delta_formula(
        last_modified_field=last_modified_field,
        published_field=published_field,
        cursor_utc=previous_cursor,
    )

    print(f"[{target.name}] Fetching changed records since {previous_cursor} ...")
    try:
        changed_records = fetch_all_records(
            token=token,
            base_id=base_id,
            table_id=target.table_id,
            view_id=target.view_id,
            filter_formula=delta_formula,
        )
    except RuntimeError as exc:
        if is_unknown_field_error(exc):
            return None
        raise

    headers = ensure_record_id_header(existing_headers)
    changed_count = 0

    for record in changed_records:
        fields = record.get("fields", {})
        record_id = normalize_text(record.get("id"))
        if not record_id:
            continue

        headers = merge_headers(
            headers=headers,
            incoming_fields=fields.keys(),
            preferred_headers=target.preferred_headers,
        )

        old_row = existing_rows_by_id.get(record_id)
        if old_row:
            used_media_files.difference_update(extract_media_references_from_row(old_row))

        if published_field and not is_published(fields.get(published_field)):
            existing_rows_by_id.pop(record_id, None)
            changed_count += 1
            continue

        row = record_to_csv_row(
            record=record,
            headers=headers,
            media_dir=media_dir,
            cache_media=cache_media,
            cache_media_types=cache_media_types,
            used_media_files=used_media_files,
            download_budget=download_budget,
            max_media_file_bytes=max_media_file_bytes,
        )
        existing_rows_by_id[record_id] = row
        changed_count += 1

    rows = list(existing_rows_by_id.values())
    write_csv(target.output_csv, headers, rows)

    updated_last_modified_field = discover_field_name_from_records(changed_records, target.last_modified_field_candidates)
    if not updated_last_modified_field:
        updated_last_modified_field = last_modified_field

    updated_published_field = discover_field_name_from_records(changed_records, target.published_field_candidates)
    if not updated_published_field:
        updated_published_field = published_field

    changed_cursor = compute_max_modified_cursor(changed_records, updated_last_modified_field)
    sync_cursor = latest_timestamp_iso(previous_cursor, changed_cursor) or datetime.now(timezone.utc).isoformat()

    write_metadata(
        path=target.metadata_path,
        metadata={
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "dataset": target.name,
            "record_count": len(rows),
            "media_cached": cache_media,
            "media_files_in_use": len(used_media_files),
            "base_id": base_id,
            "table_id": target.table_id,
            "view_id": target.view_id,
            "sync_mode": "delta",
            "changed_records": changed_count,
            "published_field": updated_published_field,
            "last_modified_field": updated_last_modified_field,
            "sync_cursor_utc": sync_cursor,
        },
    )

    return RefreshResult(
        mode="delta",
        record_count=len(rows),
        changed_records=changed_count,
        sync_cursor_utc=sync_cursor,
        published_field=updated_published_field,
        last_modified_field=updated_last_modified_field,
    )


def refresh_target_full(
    *,
    token: str,
    base_id: str,
    target: ExportTarget,
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
    download_budget: dict[str, int] | None,
    max_media_file_bytes: int,
    previous_metadata: dict[str, Any],
) -> RefreshResult:
    previous_published_field = resolve_known_field_name(
        previous_metadata=previous_metadata,
        known_headers=[],
        candidates=target.published_field_candidates,
        metadata_key="published_field",
    )

    full_formula = build_published_formula(previous_published_field) if previous_published_field else None

    print(f"[{target.name}] Fetching full dataset from Airtable ...")
    records: list[dict[str, Any]]
    try:
        records = fetch_all_records(
            token=token,
            base_id=base_id,
            table_id=target.table_id,
            view_id=target.view_id,
            filter_formula=full_formula,
        )
    except RuntimeError as exc:
        if full_formula and is_unknown_field_error(exc):
            records = fetch_all_records(
                token=token,
                base_id=base_id,
                table_id=target.table_id,
                view_id=target.view_id,
                filter_formula=None,
            )
            previous_published_field = ""
        else:
            raise

    discovered_published_field = discover_field_name_from_records(records, target.published_field_candidates)
    discovered_last_modified_field = discover_field_name_from_records(records, target.last_modified_field_candidates)

    published_field = discovered_published_field or previous_published_field
    if published_field:
        records = [record for record in records if is_published(record.get("fields", {}).get(published_field))]

    headers = compute_headers(records, preferred_headers=target.preferred_headers)
    headers = ensure_record_id_header(headers)

    rows: list[dict[str, str]] = []
    for record in records:
        row = record_to_csv_row(
            record=record,
            headers=headers,
            media_dir=media_dir,
            cache_media=cache_media,
            cache_media_types=cache_media_types,
            used_media_files=used_media_files,
            download_budget=download_budget,
            max_media_file_bytes=max_media_file_bytes,
        )
        rows.append(row)

    write_csv(target.output_csv, headers, rows)

    sync_cursor = compute_max_modified_cursor(records, discovered_last_modified_field)
    if not sync_cursor:
        sync_cursor = datetime.now(timezone.utc).isoformat()

    write_metadata(
        path=target.metadata_path,
        metadata={
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "dataset": target.name,
            "record_count": len(rows),
            "media_cached": cache_media,
            "media_files_in_use": len(used_media_files),
            "base_id": base_id,
            "table_id": target.table_id,
            "view_id": target.view_id,
            "sync_mode": "full",
            "changed_records": len(rows),
            "published_field": published_field,
            "last_modified_field": discovered_last_modified_field,
            "sync_cursor_utc": sync_cursor,
        },
    )

    return RefreshResult(
        mode="full",
        record_count=len(rows),
        changed_records=len(rows),
        sync_cursor_utc=sync_cursor,
        published_field=published_field,
        last_modified_field=discovered_last_modified_field,
    )


def fetch_all_records(
    *,
    token: str,
    base_id: str,
    table_id: str,
    view_id: str,
    filter_formula: str | None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = None

    while True:
        params = {"pageSize": "100", "view": view_id}
        if filter_formula:
            params["filterByFormula"] = filter_formula
        if offset:
            params["offset"] = offset
        url = f"https://api.airtable.com/v0/{base_id}/{table_id}?{urlencode(params)}"

        payload = get_json(url, token)
        chunk = payload.get("records", [])
        records.extend(chunk)
        offset = payload.get("offset")
        if not offset:
            break

    return records


def get_json(url: str, token: str) -> dict[str, Any]:
    request = Request(url)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", "application/json")
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Airtable request failed ({exc.code}): {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error while contacting Airtable: {exc.reason}") from exc


def compute_headers(records: Iterable[dict[str, Any]], preferred_headers: list[str] | None = None) -> list[str]:
    preferred = preferred_headers or []
    seen: set[str] = set(preferred)
    extras: list[str] = []
    for record in records:
        fields = record.get("fields", {})
        for key in fields.keys():
            if key in seen:
                continue
            seen.add(key)
            extras.append(key)
    return preferred + extras


def merge_headers(headers: list[str], incoming_fields: Iterable[str], preferred_headers: list[str]) -> list[str]:
    merged = ensure_record_id_header(headers)
    seen = set(merged)

    for field in preferred_headers:
        if field and field not in seen:
            merged.append(field)
            seen.add(field)

    for field in incoming_fields:
        if field not in seen:
            merged.append(field)
            seen.add(field)

    return merged


def ensure_record_id_header(headers: list[str]) -> list[str]:
    filtered = [header for header in headers if header != RECORD_ID_HEADER]
    return [RECORD_ID_HEADER, *filtered]


def record_to_csv_row(
    *,
    record: dict[str, Any],
    headers: list[str],
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
    download_budget: dict[str, int] | None,
    max_media_file_bytes: int,
) -> dict[str, str]:
    fields = record.get("fields", {})
    row: dict[str, str] = {}

    for header in headers:
        if header == RECORD_ID_HEADER:
            row[header] = normalize_text(record.get("id"))
            continue
        value = fields.get(header, "")
        row[header] = stringify_value(
            value=value,
            media_dir=media_dir,
            cache_media=cache_media,
            cache_media_types=cache_media_types,
            used_media_files=used_media_files,
            download_budget=download_budget,
            max_media_file_bytes=max_media_file_bytes,
        )

    return row


def stringify_value(
    *,
    value: Any,
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
    download_budget: dict[str, int] | None,
    max_media_file_bytes: int,
) -> str:
    if value is None:
        return ""

    if isinstance(value, list):
        if is_attachment_list(value):
            return format_attachments(
                attachments=value,
                media_dir=media_dir,
                cache_media=cache_media,
                cache_media_types=cache_media_types,
                used_media_files=used_media_files,
                download_budget=download_budget,
                max_media_file_bytes=max_media_file_bytes,
            )
        return ",".join(filter(None, (stringify_scalar(item) for item in value)))

    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True, ensure_ascii=False)

    return stringify_scalar(value)


def is_attachment_list(items: list[Any]) -> bool:
    if not items:
        return False
    return all(isinstance(item, dict) and "url" in item for item in items)


def stringify_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def format_attachments(
    *,
    attachments: list[dict[str, Any]],
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
    download_budget: dict[str, int] | None,
    max_media_file_bytes: int,
) -> str:
    output_parts: list[str] = []
    for attachment in attachments:
        source_url = str(attachment.get("url", "")).strip()
        if not source_url:
            continue

        filename = sanitize_filename(str(attachment.get("filename", "")).strip(), source_url)
        if is_blocked_media(filename, source_url):
            continue
        attachment_id = str(attachment.get("id", "")).strip() or short_hash(source_url)
        local_filename = f"{attachment_id}_{filename}"
        local_path = media_dir / local_filename
        attachment_type = classify_attachment_type(attachment=attachment, filename=filename, source_url=source_url)
        should_cache = cache_media and (cache_media_types is None or attachment_type in cache_media_types)

        if not should_cache:
            continue

        source_size = attachment.get("size")
        if isinstance(source_size, (int, float)) and int(source_size) > max_media_file_bytes:
            print(
                f"Skipping oversized attachment (> {max_media_file_bytes} bytes): {filename} ({int(source_size)} bytes)"
            )
            continue

        if not local_path.exists():
            if download_budget is not None and download_budget["remaining"] <= 0:
                continue
            download_binary(source_url, local_path)
            downloaded_size = local_path.stat().st_size if local_path.exists() else 0
            if downloaded_size > max_media_file_bytes:
                local_path.unlink(missing_ok=True)
                print(
                    f"Skipping oversized downloaded file (> {max_media_file_bytes} bytes): "
                    f"{filename} ({downloaded_size} bytes)"
                )
                continue
            if download_budget is not None:
                download_budget["remaining"] -= 1
        used_media_files.add(local_filename)
        link_target = f"data/media/{local_filename}"
        output_parts.append(f"{filename} ({link_target})")
    return ",".join(output_parts)


def classify_attachment_type(*, attachment: dict[str, Any], filename: str, source_url: str) -> str:
    declared_type = normalize_text(attachment.get("type")).lower()
    if declared_type.startswith("image/"):
        return "image"
    if declared_type == "application/pdf":
        return "pdf"

    thumbnails = attachment.get("thumbnails")
    if isinstance(thumbnails, dict) and thumbnails:
        # Airtable includes thumbnails only for images.
        return "image"

    return infer_attachment_type(filename, source_url)


def sanitize_filename(name: str, url: str) -> str:
    if not name:
        name = infer_name_from_url(url)
    name = name.replace(" ", "_")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    name = name.strip("._")
    if not name:
        name = f"attachment_{short_hash(url)}"
    return name[:180]


def infer_name_from_url(url: str) -> str:
    candidate = url.split("?")[0].rstrip("/").split("/")[-1]
    return candidate or "attachment"


def short_hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]


def download_binary(url: str, path: Path) -> None:
    attempts = 3
    for attempt in range(1, attempts + 1):
        request = Request(url)
        request.add_header("Accept", "*/*")
        request.add_header("User-Agent", "ztimeline-refresh/1.0")
        temporary_path = path.with_suffix(f"{path.suffix}.tmp")
        try:
            with urlopen(request, timeout=180) as response:
                path.parent.mkdir(parents=True, exist_ok=True)
                with temporary_path.open("wb") as file_handle:
                    shutil.copyfileobj(response, file_handle)
                temporary_path.replace(path)
                return
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if attempt < attempts and 500 <= exc.code <= 599:
                time.sleep(attempt * 2)
                continue
            raise RuntimeError(f"Attachment download failed ({exc.code}) for {url}: {body}") from exc
        except URLError as exc:
            if attempt < attempts:
                time.sleep(attempt * 2)
                continue
            raise RuntimeError(f"Attachment download failed for {url}: {exc.reason}") from exc
        finally:
            if temporary_path.exists():
                temporary_path.unlink(missing_ok=True)


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_existing_rows_by_record_id(path: Path) -> tuple[list[str], dict[str, dict[str, str]]]:
    if not path.exists():
        return [], {}

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        rows_by_id: dict[str, dict[str, str]] = {}
        for row in reader:
            record_id = normalize_text(row.get(RECORD_ID_HEADER))
            if not record_id:
                continue
            rows_by_id[record_id] = {header: row.get(header, "") for header in headers}

    return headers, rows_by_id


def prune_stale_media(media_dir: Path, used_media_files: set[str]) -> None:
    removed = 0
    for child in media_dir.iterdir():
        if child.is_file() and child.name not in used_media_files:
            child.unlink()
            removed += 1
    if removed:
        print(f"Pruned {removed} stale media files.")


def parse_cache_media_types(raw_value: str) -> set[str] | None:
    value = (raw_value or "").strip().lower()
    if not value:
        return None

    allowed = {"image", "pdf", "file"}
    selected = {part.strip() for part in value.split(",") if part.strip()}
    invalid = sorted(selected - allowed)
    if invalid:
        raise ValueError(f"Unsupported media types for --cache-media-types: {', '.join(invalid)}")
    return selected


def infer_attachment_type(filename: str, source_url: str) -> str:
    value = f"{filename} {source_url}".lower()
    match = re.search(r"\.([a-z0-9]+)(?:$|[?#)\s])", value)
    if not match:
        return "file"
    extension = match.group(1)
    if extension in BLOCKED_MEDIA_EXTENSIONS:
        return "blocked"
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in PDF_EXTENSIONS:
        return "pdf"
    return "file"


def is_blocked_media(filename: str, source_url: str) -> bool:
    value = f"{filename} {source_url}".lower()
    match = re.search(r"\.([a-z0-9]+)(?:$|[?#)\s])", value)
    if not match:
        return False
    return match.group(1) in BLOCKED_MEDIA_EXTENSIONS


def extract_media_references_from_row(row: dict[str, str]) -> set[str]:
    references: set[str] = set()
    for value in row.values():
        if not value:
            continue
        text = str(value)
        for match in MEDIA_REFERENCE_PATTERN.finditer(text):
            references.add(match.group(1))
    return references


def build_delta_formula(*, last_modified_field: str, published_field: str, cursor_utc: str) -> str:
    escaped_cursor = formula_string(cursor_utc)
    if published_field:
        return (
            f"OR(IS_AFTER({formula_field(last_modified_field)}, DATETIME_PARSE({escaped_cursor})), "
            f"NOT({formula_field(published_field)}))"
        )
    return f"IS_AFTER({formula_field(last_modified_field)}, DATETIME_PARSE({escaped_cursor}))"


def build_published_formula(published_field: str) -> str:
    if not published_field:
        return ""
    return formula_field(published_field)


def formula_field(field_name: str) -> str:
    return "{" + field_name + "}"


def formula_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def is_unknown_field_error(error: RuntimeError) -> bool:
    message = str(error)
    return "UNKNOWN_FIELD_NAME" in message or "Unknown field names" in message


def is_published(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        return lowered in {"1", "true", "yes", "y", "on", "checked"}
    return bool(value)


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def sync_root_fallback_csv(target: ExportTarget) -> None:
    fallback_name = ROOT_FALLBACK_CSV_BY_TARGET.get(target.name)
    if not fallback_name:
        return
    destination = Path(fallback_name)
    try:
        if target.output_csv.resolve() == destination.resolve():
            return
    except OSError:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(target.output_csv, destination)


def parse_iso_datetime(value: str) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def latest_timestamp_iso(*values: str) -> str:
    latest: datetime | None = None
    for value in values:
        parsed = parse_iso_datetime(value)
        if not parsed:
            continue
        if latest is None or parsed > latest:
            latest = parsed
    return latest.isoformat() if latest else ""


def compute_max_modified_cursor(records: list[dict[str, Any]], last_modified_field: str) -> str:
    if not last_modified_field:
        return ""

    latest: datetime | None = None
    for record in records:
        fields = record.get("fields", {})
        parsed = parse_iso_datetime(fields.get(last_modified_field))
        if not parsed:
            continue
        if latest is None or parsed > latest:
            latest = parsed

    return latest.isoformat() if latest else ""


def discover_field_name_from_records(records: list[dict[str, Any]], candidates: list[str]) -> str:
    if not records:
        return ""

    found: set[str] = set()
    for record in records:
        fields = record.get("fields", {})
        found.update(fields.keys())

    return first_matching_name(found, candidates)


def resolve_known_field_name(
    *,
    previous_metadata: dict[str, Any],
    known_headers: list[str],
    candidates: list[str],
    metadata_key: str,
) -> str:
    from_metadata = normalize_text(previous_metadata.get(metadata_key))
    if from_metadata:
        return from_metadata
    return first_matching_name(set(known_headers), candidates)


def first_matching_name(existing_names: set[str], candidates: list[str]) -> str:
    lowered_map = {name.strip().lower(): name for name in existing_names}
    for candidate in candidates:
        key = candidate.strip().lower()
        if key in lowered_map:
            return lowered_map[key]
    return ""


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    if isinstance(data, dict):
        return data
    return {}


def write_metadata(*, path: Path, metadata: dict[str, Any]) -> None:
    path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
