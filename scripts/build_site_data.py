#!/usr/bin/env python3
"""
Build normalized JSON assets for the redesigned static archive.

This script reads the locally synced CSV exports and produces:

- data/site-shell.json
- data/overview.json
- data/search-index.json
- data/events.json
- data/people.json
- data/locations.json
- data/tags.json
- data/media-manifest.json

It also optionally creates local image derivatives for thumbnail and medium-sized
display assets when Pillow or macOS `sips` is available.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from PIL import Image, ImageOps
except Exception:  # pragma: no cover - optional dependency
    Image = None
    ImageOps = None


RECORD_ID_PATTERN = re.compile(r"^rec[a-z0-9]{10,}$", re.IGNORECASE)
TRAILING_URL_PUNCTUATION = re.compile(r"[),.;!?]+$")
ATTACHMENT_TOKEN_PATTERN = re.compile(r"([^,]*?)\s*\(([^)\s]+)\)")
URL_PATTERN = re.compile(r"https?://[^\s,•]+|data/media/[^\s,•]+")
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif"}
DERIVATIVE_SOURCE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "bmp"}
BLOCKED_MEDIA_EXTENSIONS = {"tif", "tiff"}
PDF_EXTENSIONS = {"pdf"}
UNKNOWN_TIME_MINUTES = 24 * 60 + 1


@dataclass(frozen=True)
class BuildConfig:
    repo_root: Path
    media_dir: Path
    events_csv: Path
    people_csv: Path
    locations_csv: Path
    tags_csv: Path
    elements_csv: Path
    elements_fallback_csv: Path
    events_metadata_path: Path
    shell_output: Path
    overview_output: Path
    search_output: Path
    events_output: Path
    people_output: Path
    locations_output: Path
    tags_output: Path
    media_manifest_output: Path
    enable_derivatives: bool
    legacy_url: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build normalized JSON data for the redesigned archive.")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--media-dir", default="data/media")
    parser.add_argument("--events-csv", default="data/events-timeline.csv")
    parser.add_argument("--people-csv", default="data/people-people-sync.csv")
    parser.add_argument("--locations-csv", default="data/location-location-sync.csv")
    parser.add_argument("--tags-csv", default="data/tags-tags-sync.csv")
    parser.add_argument("--elements-csv", default="data/elements-elements-sync.csv")
    parser.add_argument("--elements-fallback-csv", default="data/elements-starter.csv")
    parser.add_argument("--events-metadata-path", default="data/refresh-metadata.json")
    parser.add_argument("--shell-output", default="data/site-shell.json")
    parser.add_argument("--overview-output", default="data/overview.json")
    parser.add_argument("--search-output", default="data/search-index.json")
    parser.add_argument("--events-output", default="data/events.json")
    parser.add_argument("--people-output", default="data/people.json")
    parser.add_argument("--locations-output", default="data/locations.json")
    parser.add_argument("--tags-output", default="data/tags.json")
    parser.add_argument("--media-manifest-output", default="data/media-manifest.json")
    parser.add_argument("--legacy-url", default="/index_v1.html")
    parser.add_argument("--skip-derivatives", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    config = BuildConfig(
        repo_root=repo_root,
        media_dir=(repo_root / args.media_dir).resolve(),
        events_csv=(repo_root / args.events_csv).resolve(),
        people_csv=(repo_root / args.people_csv).resolve(),
        locations_csv=(repo_root / args.locations_csv).resolve(),
        tags_csv=(repo_root / args.tags_csv).resolve(),
        elements_csv=(repo_root / args.elements_csv).resolve(),
        elements_fallback_csv=(repo_root / args.elements_fallback_csv).resolve(),
        events_metadata_path=(repo_root / args.events_metadata_path).resolve(),
        shell_output=(repo_root / args.shell_output).resolve(),
        overview_output=(repo_root / args.overview_output).resolve(),
        search_output=(repo_root / args.search_output).resolve(),
        events_output=(repo_root / args.events_output).resolve(),
        people_output=(repo_root / args.people_output).resolve(),
        locations_output=(repo_root / args.locations_output).resolve(),
        tags_output=(repo_root / args.tags_output).resolve(),
        media_manifest_output=(repo_root / args.media_manifest_output).resolve(),
        enable_derivatives=not args.skip_derivatives,
        legacy_url=args.legacy_url,
    )
    build_site_data_assets(config)
    return 0


def build_site_data_assets(config: BuildConfig) -> None:
    events_rows = read_csv_rows(config.events_csv)
    people_rows = read_csv_rows(config.people_csv)
    locations_rows = read_csv_rows(config.locations_csv)
    tags_rows = read_csv_rows(config.tags_csv)
    elements_rows = read_csv_rows(config.elements_csv)
    elements_fallback_rows = read_csv_rows(config.elements_fallback_csv)
    metadata = read_json(config.events_metadata_path)

    media_builder = MediaAssetBuilder(
        repo_root=config.repo_root,
        media_dir=config.media_dir,
        manifest_output=config.media_manifest_output,
        enabled=config.enable_derivatives,
    )

    event_summaries = build_summary_lookup(events_rows, name_fields=["Event Name"], slug_fields=["Slug"])
    people_summaries = build_summary_lookup(
        people_rows,
        name_fields=["Full Name", "Person", "Name"],
        slug_fields=["Slug"],
    )
    location_summaries = build_summary_lookup(
        locations_rows,
        name_fields=["Location", "Name"],
        slug_fields=["Slug"],
    )
    tag_summaries = build_summary_lookup(tags_rows, name_fields=["Tag", "Name"], slug_fields=["Slug"])

    events = build_events(
        events_rows=events_rows,
        people_lookup=people_summaries,
        location_lookup=location_summaries,
        tag_lookup=tag_summaries,
        media_builder=media_builder,
    )
    people = build_people(
        people_rows=people_rows,
        event_lookup=event_summaries,
        people_lookup=people_summaries,
        location_lookup=location_summaries,
        tag_lookup=tag_summaries,
        media_builder=media_builder,
    )
    locations = build_locations(
        location_rows=locations_rows,
        event_lookup=event_summaries,
        people_lookup=people_summaries,
        location_lookup=location_summaries,
        tag_lookup=tag_summaries,
        media_builder=media_builder,
    )
    tags = build_tags(
        tag_rows=tags_rows,
        event_lookup=event_summaries,
        people_lookup=people_summaries,
        location_lookup=location_summaries,
        tag_lookup=tag_summaries,
        media_builder=media_builder,
    )

    shell = build_shell_payload(
        metadata=metadata,
        elements_rows=elements_rows,
        fallback_elements_rows=elements_fallback_rows,
        legacy_url=config.legacy_url,
    )
    overview = build_overview_payload(shell=shell, metadata=metadata, events=events, people=people, locations=locations, tags=tags)
    search_index = build_search_index(events=events, people=people, locations=locations, tags=tags)
    events_payload = build_events_payload(events)
    people_payload = {"generatedAt": shell["freshness"].get("generatedAt", ""), "items": people}
    locations_payload = {"generatedAt": shell["freshness"].get("generatedAt", ""), "items": locations}
    tags_payload = {"generatedAt": shell["freshness"].get("generatedAt", ""), "items": tags}

    write_json(config.shell_output, shell)
    write_json(config.overview_output, overview)
    write_json(config.search_output, {"generatedAt": shell["freshness"].get("generatedAt", ""), "items": search_index})
    write_json(config.events_output, events_payload)
    write_json(config.people_output, people_payload)
    write_json(config.locations_output, locations_payload)
    write_json(config.tags_output, tags_payload)
    media_builder.write_manifest()


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [{key: normalize_text(value) for key, value in row.items()} for row in reader]


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_key(value: Any) -> str:
    return normalize_text(value).lower()


def slugify(value: Any) -> str:
    text = normalize_key(value)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def sanitize_url(value: Any) -> str:
    text = TRAILING_URL_PUNCTUATION.sub("", normalize_text(value))
    if not text:
        return ""
    if text.startswith("data/media/"):
        return text
    parsed = urlparse(text)
    if parsed.scheme in {"http", "https"}:
        return text
    return ""


def parse_list(value: Any) -> list[str]:
    text = normalize_text(value)
    if not text:
        return []

    items: list[str] = []
    current = []
    quoted = False
    index = 0

    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""
        if quoted:
            if char == '"' and next_char == '"':
                current.append('"')
                index += 2
                continue
            if char == '"':
                quoted = False
                index += 1
                continue
            current.append(char)
            index += 1
            continue

        if char == '"':
            quoted = True
            index += 1
            continue
        if char == ",":
            token = normalize_text("".join(current))
            if token:
                items.append(token)
            current = []
            index += 1
            continue
        current.append(char)
        index += 1

    token = normalize_text("".join(current))
    if token:
        items.append(token)
    return items


def parse_urls(value: Any) -> list[str]:
    text = normalize_text(value)
    if not text:
        return []
    found = [sanitize_url(match.group(0)) for match in URL_PATTERN.finditer(text)]
    return unique_strings([item for item in found if item])


def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        key = normalize_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(value)
    return output


def is_record_id(value: Any) -> bool:
    return bool(RECORD_ID_PATTERN.match(normalize_text(value)))


def is_truthy(value: Any, default: bool = False) -> bool:
    text = normalize_key(value)
    if not text:
        return default
    return text in {"1", "true", "yes", "y", "on", "checked", "published", "active", "enabled"}


def safe_int(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def pick_first(row: dict[str, str], fields: list[str]) -> str:
    for field in fields:
        value = normalize_text(row.get(field))
        if value:
            return value
    return ""


def build_summary_lookup(rows: list[dict[str, str]], *, name_fields: list[str], slug_fields: list[str]) -> dict[str, dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for row in rows:
        record_id = normalize_text(row.get("_Airtable Record ID"))
        name = pick_first(row, name_fields)
        if not record_id or not name:
            continue
        slug = pick_first(row, slug_fields) or slugify(name)
        lookup[normalize_key(record_id)] = {
            "id": record_id,
            "name": name,
            "slug": slug,
        }
    return lookup


def build_name_index(lookup: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    index: dict[str, dict[str, str]] = {}
    for item in lookup.values():
        for candidate in {normalize_key(item["id"]), normalize_key(item["name"]), normalize_key(item["slug"])}:
            if candidate and candidate not in index:
                index[candidate] = item
    return index


def resolve_reference_list(raw_values: list[str], lookup: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    if not raw_values:
        return []

    name_index = build_name_index(lookup)
    output: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_value in raw_values:
        for item in parse_list(raw_value):
            key = normalize_key(item)
            if not key:
                continue
            resolved = lookup.get(key) if is_record_id(item) else name_index.get(key)
            if resolved:
                dedupe_key = normalize_key(resolved["id"])
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                output.append(dict(resolved))
                continue
            slug = slugify(item)
            dedupe_key = key
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            output.append({"id": "", "name": item, "slug": slug})
    return output


def parse_source_links(value: Any) -> list[dict[str, str]]:
    text = normalize_text(value)
    if not text:
        return []

    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        clean = line.strip().lstrip("-* ").strip()
        if not clean:
            continue
        label_match = re.match(r"^(.+?)\s*(?:\||:)\s*(https?://\S+)\s*$", clean, re.IGNORECASE)
        markdown_match = re.match(r"^\[([^\]]+)\]\((https?://[^)\s]+)\)$", clean, re.IGNORECASE)
        url = ""
        label = ""
        if label_match:
            label = normalize_text(label_match.group(1))
            url = sanitize_url(label_match.group(2))
        elif markdown_match:
            label = normalize_text(markdown_match.group(1))
            url = sanitize_url(markdown_match.group(2))
        else:
            urls = parse_urls(clean)
            if urls:
                url = urls[0]
                label = ""
        if not url or url in seen or is_pdf_url(url):
            continue
        seen.add(url)
        links.append({"label": label or f"Source {len(links) + 1}", "url": url})
    return links


def parse_attachment_field(value: Any) -> list[dict[str, str]]:
    text = normalize_text(value)
    if not text:
        return []
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in ATTACHMENT_TOKEN_PATTERN.finditer(text):
        label = normalize_text(match.group(1)) or "Attachment"
        url = sanitize_url(match.group(2))
        if not url or url in seen:
            continue
        if infer_attachment_type(url) == "blocked":
            continue
        seen.add(url)
        items.append({"label": label, "url": url})
    if items:
        return items
    for index, url in enumerate(parse_urls(text), start=1):
        if url in seen or infer_attachment_type(url) == "blocked":
            continue
        seen.add(url)
        items.append({"label": f"Attachment {index}", "url": url})
    return items


def infer_attachment_type(value: Any) -> str:
    text = normalize_key(value)
    match = re.search(r"\.([a-z0-9]+)(?:$|[?#)\s])", text)
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


def is_pdf_url(value: Any) -> bool:
    return infer_attachment_type(value) == "pdf"


def parse_date(value: Any) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_time_minutes(row: dict[str, str]) -> int:
    candidates = [row.get("Time (AM/PM)"), row.get("Time"), row.get("Event Timing")]
    for raw_value in candidates:
        value = normalize_text(raw_value)
        if not value or value in {"0", "00:00:00", "00:00"}:
            continue
        minutes = parse_numeric_time(value)
        if minutes != UNKNOWN_TIME_MINUTES:
            return minutes
        minutes = parse_meridiem_time(value)
        if minutes != UNKNOWN_TIME_MINUTES:
            return minutes
    return UNKNOWN_TIME_MINUTES


def parse_numeric_time(value: str) -> int:
    text = normalize_text(value)
    if not re.fullmatch(r"\d{1,8}", text):
        return UNKNOWN_TIME_MINUTES
    numeric = int(text)
    if 0 <= numeric <= 1439:
        return numeric
    if len(text) in {3, 4}:
        hours = numeric // 100
        minutes = numeric % 100
        if 0 <= hours <= 23 and 0 <= minutes <= 59:
            return hours * 60 + minutes
    if 0 <= numeric <= 86399:
        return numeric // 60
    if 0 <= numeric <= 86399999 and numeric % 1000 == 0:
        return numeric // 60000
    return UNKNOWN_TIME_MINUTES


def parse_meridiem_time(value: str) -> int:
    text = normalize_key(value)
    match = re.search(r"(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?", text)
    if match:
        hours = int(match.group(1))
        minutes = int(match.group(2) or "0")
        meridiem = match.group(3)
        if 1 <= hours <= 12 and 0 <= minutes <= 59:
            if meridiem == "p" and hours < 12:
                hours += 12
            elif meridiem == "a" and hours == 12:
                hours = 0
            return hours * 60 + minutes
    match = re.search(r"(?:^|[^\d])(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)", text)
    if match:
        hours = int(match.group(1))
        minutes = int(match.group(2))
        if 0 <= hours <= 23 and 0 <= minutes <= 59:
            return hours * 60 + minutes
    return UNKNOWN_TIME_MINUTES


def format_time_label(minutes: int) -> str:
    if minutes == UNKNOWN_TIME_MINUTES:
        return ""
    hours_24 = minutes // 60
    minute_part = minutes % 60
    meridiem = "PM" if hours_24 >= 12 else "AM"
    hours_12 = hours_24 % 12 or 12
    return f"{hours_12}:{minute_part:02d} {meridiem}"


def format_date_label(parsed: datetime | None) -> str:
    if not parsed:
        return "Unknown Date"
    return parsed.strftime("%a, %b %-d, %Y") if os.name != "nt" else parsed.strftime("%a, %b %#d, %Y")


def markdown_excerpt(text: str, limit: int = 220) -> str:
    clean = re.sub(r"\s+", " ", normalize_text(text))
    if len(clean) <= limit:
        return clean
    return clean[: limit - 1].rstrip() + "…"


def build_events(
    *,
    events_rows: list[dict[str, str]],
    people_lookup: dict[str, dict[str, str]],
    location_lookup: dict[str, dict[str, str]],
    tag_lookup: dict[str, dict[str, str]],
    media_builder: "MediaAssetBuilder",
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for index, row in enumerate(events_rows):
        record_id = normalize_text(row.get("_Airtable Record ID"))
        title = normalize_text(row.get("Event Name")) or "Untitled event"
        slug = slugify(title) or record_id.lower()
        parsed_date = parse_date(row.get("Beginning Date"))
        time_minutes = parse_time_minutes(row)
        locations = resolve_reference_list([row.get("Location", ""), row.get("All Related Locations", "")], location_lookup)
        people = resolve_reference_list([row.get("Related People & Groups", ""), row.get("All Related People Names", "")], people_lookup)
        tags = resolve_reference_list([row.get("Tags", "")], tag_lookup)
        images = [
            media_builder.asset_for(item["url"], item["label"])
            for item in [*parse_attachment_field(row.get("Images")), *parse_attachment_field(row.get("Document Images"))]
            if infer_attachment_type(item["url"]) == "image"
        ]
        sources = [item for item in parse_source_links(row.get("Sources")) if not item["url"].startswith("data/media/")]
        description = normalize_text(row.get("Description"))
        event_type = normalize_text(row.get("Type")) or "Uncategorized"
        year = parsed_date.year if parsed_date else safe_int(row.get("Event Year"))
        searchable = " ".join(
            filter(
                None,
                [
                    title,
                    description,
                    event_type,
                    " ".join(item["name"] for item in locations),
                    " ".join(item["name"] for item in people),
                    " ".join(item["name"] for item in tags),
                ],
            )
        )
        events.append(
            {
                "id": record_id,
                "slug": slug,
                "kind": "event",
                "title": title,
                "date": parsed_date.strftime("%Y-%m-%d") if parsed_date else "",
                "dateLabel": format_date_label(parsed_date),
                "year": year,
                "timeLabel": format_time_label(time_minutes),
                "sortTime": time_minutes,
                "sortValue": build_event_sort_value(parsed_date, time_minutes, index),
                "type": event_type,
                "description": description,
                "excerpt": markdown_excerpt(description),
                "locations": locations,
                "people": people,
                "tags": tags,
                "images": images,
                "sources": sources,
                "mapUrl": first_valid_url(
                    row.get("Google Maps"),
                    row.get("Google Maps URL"),
                    row.get("Primary Google Maps"),
                    row.get("Map URL"),
                ),
                "hasMedia": bool(images),
                "searchText": searchable,
            }
        )
    return sorted(events, key=lambda item: item["sortValue"])


def build_event_sort_value(parsed_date: datetime | None, time_minutes: int, fallback_index: int) -> str:
    date_value = parsed_date.strftime("%Y-%m-%d") if parsed_date else "9999-99-99"
    time_value = "9999" if time_minutes == UNKNOWN_TIME_MINUTES else f"{time_minutes:04d}"
    return f"{date_value}-{time_value}-{fallback_index:05d}"


def build_people(
    *,
    people_rows: list[dict[str, str]],
    event_lookup: dict[str, dict[str, str]],
    people_lookup: dict[str, dict[str, str]],
    location_lookup: dict[str, dict[str, str]],
    tag_lookup: dict[str, dict[str, str]],
    media_builder: "MediaAssetBuilder",
) -> list[dict[str, Any]]:
    people: list[dict[str, Any]] = []
    for row in people_rows:
        record_id = normalize_text(row.get("_Airtable Record ID"))
        name = pick_first(row, ["Full Name", "Person", "Name"])
        if not record_id or not name:
            continue
        aliases = unique_strings(
            [name]
            + parse_list(row.get("Aliases"))
            + parse_list(row.get("Alias"))
            + parse_list(row.get("AKA"))
            + parse_list(row.get("Also Known As"))
            + parse_list(row.get("Alternate Names"))
        )
        images = [
            media_builder.asset_for(item["url"], item["label"])
            for item in parse_attachment_field(row.get("Image"))
            if infer_attachment_type(item["url"]) == "image"
        ]
        related_events = resolve_reference_list([row.get("Related Events", "")], event_lookup)
        related_locations = resolve_reference_list(
            [row.get("Locations Linked To", ""), row.get("Locations via Events", "")],
            location_lookup,
        )
        related_tags = resolve_reference_list([row.get("Related Tags", "")], tag_lookup)
        related_people = resolve_reference_list(
            [
                row.get("Member Of / Linked Beneath", ""),
                row.get("Members of Group", ""),
                row.get("Relatives", ""),
                row.get("From field: Relatives", ""),
            ],
            people_lookup,
        )
        summary = pick_first(row, ["Short Bio", "Biography"])
        people.append(
            {
                "id": record_id,
                "slug": pick_first(row, ["Slug"]) or slugify(name),
                "kind": "person",
                "title": name,
                "subtitle": pick_first(row, ["Role in Case"]),
                "summary": summary,
                "excerpt": markdown_excerpt(summary),
                "aliases": aliases,
                "images": images,
                "primaryImage": images[0] if images else None,
                "facts": build_facts(
                    {
                        "Extended Name": pick_first(row, ["Extended Name"]),
                        "Born": pick_first(row, ["Date of Birth"]),
                        "Died": pick_first(row, ["Date of Death"]),
                        "Home / HQ": pick_first(row, ["Home / Headquarters"]),
                    }
                ),
                "relatedEvents": related_events,
                "relatedLocations": related_locations,
                "relatedPeople": [item for item in related_people if normalize_key(item["id"] or item["name"]) != normalize_key(record_id)],
                "relatedTags": related_tags,
                "downloads": build_download_links(
                    [
                        ("Documents", row.get("Documents Links and References")),
                        ("Google Search", row.get("Google Search")),
                        ("Image Search", row.get("Google Image Search")),
                    ]
                ),
                "relatedEventCount": len(related_events),
                "searchText": " ".join([name, " ".join(aliases), summary, " ".join(item["name"] for item in related_locations)]),
            }
        )
    return sorted(people, key=lambda item: (-item["relatedEventCount"], normalize_key(item["title"])))


def build_locations(
    *,
    location_rows: list[dict[str, str]],
    event_lookup: dict[str, dict[str, str]],
    people_lookup: dict[str, dict[str, str]],
    location_lookup: dict[str, dict[str, str]],
    tag_lookup: dict[str, dict[str, str]],
    media_builder: "MediaAssetBuilder",
) -> list[dict[str, Any]]:
    locations: list[dict[str, Any]] = []
    for row in location_rows:
        record_id = normalize_text(row.get("_Airtable Record ID"))
        title = pick_first(row, ["Location", "Name"])
        if not record_id or not title:
            continue
        images = [
            media_builder.asset_for(item["url"], item["label"])
            for item in parse_attachment_field(row.get("Images"))
            if infer_attachment_type(item["url"]) == "image"
        ]
        map_open_url = first_valid_url(
            row.get("Google Maps"),
            row.get("Lat/Lon Google Maps URL"),
            row.get("Manual Google Maps"),
        ) or build_coordinate_map_url(row.get("Latitude"), row.get("Longitude"))
        locations.append(
            {
                "id": record_id,
                "slug": pick_first(row, ["Slug"]) or slugify(title),
                "kind": "location",
                "title": title,
                "subtitle": pick_first(row, ["Type"]),
                "summary": pick_first(row, ["Notes"]),
                "excerpt": markdown_excerpt(pick_first(row, ["Notes"])),
                "images": images,
                "primaryImage": images[0] if images else None,
                "facts": build_facts(
                    {
                        "Address": pick_first(row, ["Address"]),
                        "Located Within": pick_first(row, ["Located Within"]),
                    }
                ),
                "relatedEvents": resolve_reference_list([row.get("Events", "")], event_lookup),
                "relatedLocations": resolve_reference_list(
                    [
                        row.get("Related Locations", ""),
                        row.get("All Related Locations", ""),
                        row.get("Related Locations Rollup", ""),
                        row.get("All Related Locations Rollup (from Located Within)", ""),
                    ],
                    location_lookup,
                ),
                "relatedPeople": resolve_reference_list(
                    [row.get("People / Orgs Linked To", ""), row.get("All Related People Names", "")],
                    people_lookup,
                ),
                "relatedTags": resolve_reference_list([row.get("Tags", "")], tag_lookup),
                "downloads": build_download_links([("Map", row.get("Google Maps")), ("Documents", row.get("Documents"))]),
                "relatedEventCount": len(resolve_reference_list([row.get("Events", "")], event_lookup)),
                "mapOpenUrl": map_open_url,
                "mapEmbedUrl": build_map_embed_url(map_open_url, row.get("Latitude"), row.get("Longitude")),
                "searchText": " ".join(
                    filter(
                        None,
                        [
                            title,
                            pick_first(row, ["Type"]),
                            pick_first(row, ["Notes"]),
                            " ".join(item["name"] for item in resolve_reference_list([row.get("People / Orgs Linked To", "")], people_lookup)),
                        ],
                    )
                ),
            }
        )
    return sorted(locations, key=lambda item: (-item["relatedEventCount"], normalize_key(item["title"])))


def build_tags(
    *,
    tag_rows: list[dict[str, str]],
    event_lookup: dict[str, dict[str, str]],
    people_lookup: dict[str, dict[str, str]],
    location_lookup: dict[str, dict[str, str]],
    tag_lookup: dict[str, dict[str, str]],
    media_builder: "MediaAssetBuilder",
) -> list[dict[str, Any]]:
    tags: list[dict[str, Any]] = []
    for row in tag_rows:
        record_id = normalize_text(row.get("_Airtable Record ID"))
        title = pick_first(row, ["Tag", "Name"])
        if not record_id or not title:
            continue
        summary = pick_first(row, ["Summary", "AI: Summary Analysis"])
        subtitle = pick_first(row, ["Tagged Under", "AI: Information Category (Detailed)"])
        images = [
            media_builder.asset_for(item["url"], item["label"])
            for item in parse_attachment_field(row.get("Document Images"))
            if infer_attachment_type(item["url"]) == "image"
        ]
        related_events = resolve_reference_list(
            [row.get("Related Event Names", ""), row.get("Related Events", "")],
            event_lookup,
        )
        tags.append(
            {
                "id": record_id,
                "slug": pick_first(row, ["Slug"]) or slugify(title),
                "kind": "tag",
                "title": title,
                "subtitle": subtitle,
                "summary": summary,
                "excerpt": markdown_excerpt(summary),
                "images": images,
                "primaryImage": images[0] if images else None,
                "facts": build_facts({"Date": pick_first(row, ["Date"])}),
                "relatedEvents": related_events,
                "relatedPeople": resolve_reference_list([row.get("Related People", ""), row.get("Related People Names", "")], people_lookup),
                "relatedLocations": resolve_reference_list([row.get("Locations", "")], location_lookup),
                "relatedTags": resolve_reference_list([row.get("Tagged Under", "")], tag_lookup),
                "downloads": build_download_links([("Documents", row.get("Related Documents"))]),
                "relatedEventCount": len(related_events),
                "searchText": " ".join([title, subtitle, summary]),
            }
        )
    return sorted(tags, key=lambda item: (-item["relatedEventCount"], normalize_key(item["title"])))


def build_download_links(definitions: list[tuple[str, Any]]) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for label, raw_value in definitions:
        for index, url in enumerate(parse_urls(raw_value), start=1):
            if url in seen or is_pdf_url(url):
                continue
            seen.add(url)
            links.append({"label": label if index == 1 else f"{label} {index}", "url": url})
    return links


def build_facts(facts: dict[str, str]) -> list[dict[str, str]]:
    return [{"label": label, "value": value} for label, value in facts.items() if normalize_text(value)]


def build_coordinate_map_url(latitude: Any, longitude: Any) -> str:
    lat = normalize_text(latitude)
    lon = normalize_text(longitude)
    if not lat or not lon:
        return ""
    try:
        float(lat)
        float(lon)
    except ValueError:
        return ""
    return f"https://www.google.com/maps?q={lat},{lon}"


def build_map_embed_url(open_url: str, latitude: Any, longitude: Any) -> str:
    coordinate_url = build_coordinate_map_url(latitude, longitude)
    if coordinate_url:
        return f"{coordinate_url}&output=embed"
    if not open_url:
        return ""
    if "google." in normalize_key(open_url):
        if "output=embed" in open_url:
            return open_url
        separator = "&" if "?" in open_url else "?"
        return f"{open_url}{separator}output=embed"
    return ""


def first_valid_url(*values: Any) -> str:
    for value in values:
        direct = sanitize_url(value)
        if direct:
            return direct
        urls = parse_urls(value)
        if urls:
            return urls[0]
    return ""


def build_shell_payload(
    *,
    metadata: dict[str, Any],
    elements_rows: list[dict[str, str]],
    fallback_elements_rows: list[dict[str, str]],
    legacy_url: str,
) -> dict[str, Any]:
    elements = normalize_elements(elements_rows or fallback_elements_rows)
    by_key = {item["key"]: item for item in elements}
    nav_links = [
        {
            "key": item["key"],
            "label": item["linkLabel"] or item["label"] or item["body"],
            "url": item["linkUrl"],
        }
        for item in elements
        if item["key"].startswith("nav.") and item["linkUrl"]
    ]
    footer_links = [
        {
            "key": item["key"],
            "label": item["linkLabel"] or item["label"] or item["body"],
            "url": item["linkUrl"],
        }
        for item in elements
        if item["linkUrl"] and not item["key"].startswith("nav.")
    ]
    legal_blocks = [item["body"] or item["label"] for item in elements if item["key"].startswith("legal.") and not item["linkUrl"]]
    generated_at = normalize_text(metadata.get("generated_at_utc") or metadata.get("sync_cursor_utc"))
    return {
        "title": get_element_text(by_key, ["site.title"]) or "ZTimeline",
        "subtitle": get_element_text(by_key, ["site.subtitle"]) or "Case Timeline Viewer",
        "intro": get_element_text(by_key, ["site.intro"]) or "Independent research archive organizing events, people, locations, and source evidence.",
        "about": get_element_text(by_key, ["site.about_blurb"]) or "",
        "heroMarkUrl": "assets/zodiac-header.png",
        "navLinks": nav_links,
        "footerLinks": footer_links,
        "legalBlocks": legal_blocks,
        "legacyUrl": legacy_url,
        "freshness": {
            "generatedAt": generated_at,
            "generatedLabel": format_timestamp_label(generated_at),
            "syncMode": normalize_text(metadata.get("sync_mode")),
        },
    }


def normalize_elements(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    elements: list[dict[str, str]] = []
    for row in rows:
        key = canonicalize_element_key(pick_first(row, ["Element Key", "Key", "Slot"]))
        if not key:
            continue
        if not is_truthy(row.get("Published"), default=True):
            continue
        elements.append(
            {
                "key": key,
                "type": normalize_key(pick_first(row, ["Element Type", "Type"])),
                "label": pick_first(row, ["Label", "Title", "Name"]),
                "body": pick_first(row, ["Body", "Text", "Content", "Value", "Copy", "Description"]),
                "linkLabel": pick_first(row, ["Link Label", "Button Label", "Link Text"]),
                "linkUrl": sanitize_url(row.get("Link URL")) or normalize_text(row.get("Link URL")),
                "sortOrder": safe_int(pick_first(row, ["Sort Order", "Sort", "Order", "Position"])) or 9999,
            }
        )
    return sorted(elements, key=lambda item: (item["sortOrder"], item["key"]))


def canonicalize_element_key(value: str) -> str:
    clean = normalize_key(value).replace(" ", ".")
    clean = re.sub(r"[^a-z0-9.]+", ".", clean)
    clean = re.sub(r"\.+", ".", clean).strip(".")
    aliases = {
        "title": "site.title",
        "subtitle": "site.subtitle",
        "intro": "site.intro",
        "about": "site.about_blurb",
    }
    return aliases.get(clean, clean)


def get_element_text(by_key: dict[str, dict[str, str]], keys: list[str]) -> str:
    for key in keys:
        element = by_key.get(key)
        if element:
            return normalize_text(element.get("body") or element.get("label"))
    return ""


def format_timestamp_label(value: str) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return text
    return parsed.strftime("%b %d, %Y, %I:%M %p UTC")


def build_overview_payload(
    *,
    shell: dict[str, Any],
    metadata: dict[str, Any],
    events: list[dict[str, Any]],
    people: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    tags: list[dict[str, Any]],
) -> dict[str, Any]:
    year_counts = Counter(item["year"] for item in events if item.get("year"))
    type_counts = Counter(item["type"] for item in events if item.get("type"))
    image_count = sum(len(item.get("images", [])) for item in [*events, *people, *locations, *tags])
    years = sorted(year_counts.keys())
    return {
        "generatedAt": shell["freshness"].get("generatedAt", ""),
        "stats": {
            "events": len(events),
            "people": len(people),
            "locations": len(locations),
            "tags": len(tags),
            "images": image_count,
            "years": {
                "start": years[0] if years else None,
                "end": years[-1] if years else None,
            },
        },
        "featuredYears": [{"value": year, "count": count} for year, count in year_counts.most_common(6)],
        "featuredTypes": [{"value": label, "count": count} for label, count in type_counts.most_common(6)],
        "featuredPeople": [strip_record_for_overview(item) for item in people[:6]],
        "featuredLocations": [strip_record_for_overview(item) for item in locations[:6]],
        "featuredTags": [strip_record_for_overview(item) for item in tags[:6]],
        "freshness": {
            "label": shell["freshness"].get("generatedLabel", ""),
            "syncMode": shell["freshness"].get("syncMode", ""),
        },
        "method": {
            "intro": shell.get("about", ""),
            "disclaimer": shell.get("legalBlocks", [])[0] if shell.get("legalBlocks") else "",
        },
        "entryPoints": [
            {
                "view": "timeline",
                "title": "Timeline",
                "description": f"{len(events)} dated events spanning {years[0] if years else 'unknown'} to {years[-1] if years else 'unknown'}.",
            },
            {
                "view": "people",
                "title": "People",
                "description": f"{len(people)} linked people and organizations with related-event cross references.",
            },
            {
                "view": "locations",
                "title": "Locations",
                "description": f"{len(locations)} places connected to the archive, including mapped sites where data exists.",
            },
            {
                "view": "tags",
                "title": "Tags",
                "description": f"{len(tags)} thematic index records for grouping evidence and events.",
            },
        ],
    }


def strip_record_for_overview(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "slug": item["slug"],
        "kind": item["kind"],
        "title": item["title"],
        "subtitle": item.get("subtitle", ""),
        "excerpt": item.get("excerpt", ""),
        "relatedEventCount": item.get("relatedEventCount", 0),
        "primaryImage": item.get("primaryImage"),
    }


def build_search_index(
    *,
    events: list[dict[str, Any]],
    people: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    tags: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for event in events:
        entries.append(
            {
                "kind": "event",
                "id": event["id"],
                "slug": event["slug"],
                "title": event["title"],
                "subtitle": " • ".join(part for part in [event["type"], event["dateLabel"]] if part),
                "searchText": " ".join(
                    [
                        event["title"],
                        event["type"],
                        event["description"],
                        " ".join(item["name"] for item in event["people"]),
                        " ".join(item["name"] for item in event["locations"]),
                        " ".join(item["name"] for item in event["tags"]),
                    ]
                ),
            }
        )
    for item in [*people, *locations, *tags]:
        entries.append(
            {
                "kind": item["kind"],
                "id": item["id"],
                "slug": item["slug"],
                "title": item["title"],
                "subtitle": item.get("subtitle", ""),
                "searchText": " ".join(
                    filter(
                        None,
                        [
                            item["title"],
                            item.get("subtitle", ""),
                            item.get("summary", ""),
                            " ".join(item.get("aliases", [])),
                            " ".join(ref["name"] for ref in item.get("relatedEvents", [])),
                            " ".join(ref["name"] for ref in item.get("relatedPeople", [])),
                            " ".join(ref["name"] for ref in item.get("relatedLocations", [])),
                            " ".join(ref["name"] for ref in item.get("relatedTags", [])),
                        ],
                    )
                ),
            }
        )
    return entries


def build_events_payload(events: list[dict[str, Any]]) -> dict[str, Any]:
    year_counts = Counter(str(item["year"]) for item in events if item.get("year"))
    type_counts = Counter(item["type"] for item in events if item.get("type"))
    location_counts = Counter(ref["name"] for item in events for ref in item.get("locations", []))
    people_counts = Counter(ref["name"] for item in events for ref in item.get("people", []))
    tag_counts = Counter(ref["name"] for item in events for ref in item.get("tags", []))
    return {
        "items": events,
        "facets": {
            "years": counter_to_facet_list(year_counts),
            "types": counter_to_facet_list(type_counts),
            "locations": counter_to_facet_list(location_counts),
            "people": counter_to_facet_list(people_counts),
            "tags": counter_to_facet_list(tag_counts),
        },
    }


def counter_to_facet_list(counter: Counter[str]) -> list[dict[str, Any]]:
    def sort_key(item: tuple[str, int]) -> tuple[int, Any]:
        value, count = item
        if str(value).isdigit():
            return (0, -int(value))
        return (1, normalize_key(value))

    return [{"value": value, "count": count} for value, count in sorted(counter.items(), key=sort_key)]


class MediaAssetBuilder:
    def __init__(self, *, repo_root: Path, media_dir: Path, manifest_output: Path, enabled: bool) -> None:
        self.repo_root = repo_root
        self.media_dir = media_dir
        self.manifest_output = manifest_output
        self.enabled = enabled
        self.thumb_dir = media_dir / "derived" / "thumb"
        self.medium_dir = media_dir / "derived" / "medium"
        self.thumb_dir.mkdir(parents=True, exist_ok=True)
        self.medium_dir.mkdir(parents=True, exist_ok=True)
        self.cache: dict[str, dict[str, Any]] = {}

    def asset_for(self, url: str, label: str) -> dict[str, Any]:
        clean_url = sanitize_url(url)
        if not clean_url:
            return {"label": label, "originalUrl": "", "thumbUrl": "", "mediumUrl": ""}
        if clean_url not in self.cache:
            self.cache[clean_url] = self._build_asset(clean_url)
        asset = dict(self.cache[clean_url])
        asset["label"] = label
        return asset

    def _build_asset(self, url: str) -> dict[str, Any]:
        base = {
            "originalUrl": url,
            "thumbUrl": url,
            "mediumUrl": url,
            "derivativeState": "original",
        }
        if not url.startswith("data/media/"):
            return base

        source_path = self.repo_root / url
        if not source_path.exists():
            return base

        extension = source_path.suffix.lower().lstrip(".")
        if extension not in DERIVATIVE_SOURCE_EXTENSIONS or not self.enabled:
            return base

        output_extension = ".png" if extension == "png" else ".jpg"
        thumb_rel = Path("data/media/derived/thumb") / f"{source_path.stem}{output_extension}"
        medium_rel = Path("data/media/derived/medium") / f"{source_path.stem}{output_extension}"
        thumb_path = self.repo_root / thumb_rel
        medium_path = self.repo_root / medium_rel

        created_thumb = ensure_derivative(source_path=source_path, output_path=thumb_path, max_dimension=420)
        created_medium = ensure_derivative(source_path=source_path, output_path=medium_path, max_dimension=1280)
        if created_thumb and created_medium:
            base["thumbUrl"] = str(thumb_rel).replace(os.sep, "/")
            base["mediumUrl"] = str(medium_rel).replace(os.sep, "/")
            base["derivativeState"] = "derived"
        return base

    def write_manifest(self) -> None:
        write_json(self.manifest_output, {"items": self.cache})


def ensure_derivative(*, source_path: Path, output_path: Path, max_dimension: int) -> bool:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists() and output_path.stat().st_mtime >= source_path.stat().st_mtime:
        return True
    if Image is not None and ImageOps is not None:
        try:
            return write_derivative_with_pillow(source_path=source_path, output_path=output_path, max_dimension=max_dimension)
        except Exception:
            pass
    if sys.platform == "darwin":
        try:
            return write_derivative_with_sips(source_path=source_path, output_path=output_path, max_dimension=max_dimension)
        except Exception:
            return False
    return False


def write_derivative_with_pillow(*, source_path: Path, output_path: Path, max_dimension: int) -> bool:
    assert Image is not None and ImageOps is not None
    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((max_dimension, max_dimension))
        if output_path.suffix.lower() == ".jpg":
            if image.mode not in {"RGB", "L"}:
                flattened = Image.new("RGB", image.size, (255, 255, 255))
                flattened.paste(image, mask=image.split()[-1] if image.mode in {"RGBA", "LA"} else None)
                image = flattened
            image.save(output_path, format="JPEG", quality=82, optimize=True)
        else:
            image.save(output_path, format="PNG", optimize=True)
    return True


def write_derivative_with_sips(*, source_path: Path, output_path: Path, max_dimension: int) -> bool:
    fmt = "png" if output_path.suffix.lower() == ".png" else "jpeg"
    command = [
        "sips",
        "-s",
        "format",
        fmt,
        "--resampleWidth",
        str(max_dimension),
        str(source_path),
        "--out",
        str(output_path),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_path.exists()


if __name__ == "__main__":
    raise SystemExit(main())
