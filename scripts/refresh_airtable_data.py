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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_BASE_ID = "appyDwtN9iiA9sjEe"
DEFAULT_TABLE_ID = "tblxd8PLtQOl1dRa7"
DEFAULT_VIEW_ID = "viwUWtXt3UUxE6LOC"
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "tif", "tiff"}
PDF_EXTENSIONS = {"pdf"}

DEFAULT_HEADERS = [
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh Airtable timeline export.")
    parser.add_argument(
        "--output-csv",
        default="data/events-timeline.csv",
        help="Path to write refreshed CSV.",
    )
    parser.add_argument(
        "--media-dir",
        default="data/media",
        help="Directory where attachment files are cached.",
    )
    parser.add_argument(
        "--metadata-path",
        default="data/refresh-metadata.json",
        help="Path to write refresh metadata JSON.",
    )
    parser.add_argument(
        "--no-cache-media",
        action="store_true",
        help="Keep Airtable attachment URLs instead of downloading files to media-dir.",
    )
    parser.add_argument(
        "--prune-media",
        action="store_true",
        help="Delete stale cached media files not referenced by refreshed records.",
    )
    parser.add_argument(
        "--cache-media-types",
        default=env_or_default("AIRTABLE_CACHE_MEDIA_TYPES", ""),
        help=(
            "Comma-separated attachment types to cache locally (image,pdf,file). "
            "Default empty caches all attachment types."
        ),
    )
    parser.add_argument(
        "--base-id",
        default=env_or_default("AIRTABLE_BASE_ID", DEFAULT_BASE_ID),
        help="Airtable base id (default from env or built-in base).",
    )
    parser.add_argument(
        "--table-id",
        default=env_or_default("AIRTABLE_TABLE_ID", DEFAULT_TABLE_ID),
        help="Airtable table id (default from env or built-in table).",
    )
    parser.add_argument(
        "--view-id",
        default=env_or_default("AIRTABLE_VIEW_ID", DEFAULT_VIEW_ID),
        help="Airtable view id (default from env or built-in view).",
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

    output_csv = Path(args.output_csv)
    media_dir = Path(args.media_dir)
    metadata_path = Path(args.metadata_path)
    cache_media = not args.no_cache_media
    try:
        cache_media_types = parse_cache_media_types(args.cache_media_types)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)

    print("Fetching records from Airtable...")
    records = fetch_all_records(
        token=token, base_id=args.base_id, table_id=args.table_id, view_id=args.view_id
    )
    print(f"Fetched {len(records)} records.")

    headers = compute_headers(records)
    used_media_files: set[str] = set()
    rows: list[dict[str, str]] = []

    for record in records:
        fields = record.get("fields", {})
        row: dict[str, str] = {}
        for header in headers:
            value = fields.get(header, "")
            row[header] = stringify_value(
                value=value,
                media_dir=media_dir,
                cache_media=cache_media,
                cache_media_types=cache_media_types,
                used_media_files=used_media_files,
            )
        rows.append(row)

    print(f"Writing CSV to {output_csv} ...")
    write_csv(output_csv, headers, rows)

    if cache_media and args.prune_media:
        prune_stale_media(media_dir, used_media_files)

    metadata = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "record_count": len(rows),
        "media_cached": cache_media,
        "media_files_in_use": len(used_media_files),
        "base_id": args.base_id,
        "table_id": args.table_id,
        "view_id": args.view_id,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Wrote metadata to {metadata_path}.")
    print("Refresh complete.")
    return 0


def fetch_all_records(*, token: str, base_id: str, table_id: str, view_id: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    offset = None

    while True:
        params = {"pageSize": "100", "view": view_id}
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


def compute_headers(records: Iterable[dict[str, Any]]) -> list[str]:
    seen_extras: set[str] = set()
    extras: list[str] = []
    for record in records:
        fields = record.get("fields", {})
        for key in fields.keys():
            if key in DEFAULT_HEADERS or key in seen_extras:
                continue
            seen_extras.add(key)
            extras.append(key)
    return DEFAULT_HEADERS + sorted(extras)


def stringify_value(
    *,
    value: Any,
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
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
    if isinstance(value, (str, int, float, bool)):
        return str(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def format_attachments(
    *,
    attachments: list[dict[str, Any]],
    media_dir: Path,
    cache_media: bool,
    cache_media_types: set[str] | None,
    used_media_files: set[str],
) -> str:
    output_parts: list[str] = []
    for attachment in attachments:
        source_url = str(attachment.get("url", "")).strip()
        if not source_url:
            continue

        filename = sanitize_filename(str(attachment.get("filename", "")).strip(), source_url)
        attachment_id = str(attachment.get("id", "")).strip() or short_hash(source_url)
        local_filename = f"{attachment_id}_{filename}"
        local_path = media_dir / local_filename
        attachment_type = infer_attachment_type(filename, source_url)
        should_cache = cache_media and (
            cache_media_types is None or attachment_type in cache_media_types
        )

        if should_cache:
            if not local_path.exists():
                download_binary(source_url, local_path)
            used_media_files.add(local_filename)
            link_target = f"data/media/{local_filename}"
        else:
            link_target = source_url

        output_parts.append(f"{filename} ({link_target})")
    return ",".join(output_parts)


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
    request = Request(url)
    request.add_header("Accept", "*/*")
    try:
        with urlopen(request, timeout=180) as response:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("wb") as file_handle:
                shutil.copyfileobj(response, file_handle)
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Attachment download failed ({exc.code}) for {url}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Attachment download failed for {url}: {exc.reason}") from exc


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


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
    if extension in IMAGE_EXTENSIONS:
        return "image"
    if extension in PDF_EXTENSIONS:
        return "pdf"
    return "file"


if __name__ == "__main__":
    raise SystemExit(main())
