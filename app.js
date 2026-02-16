const DATA_URL = "data/events-timeline.csv";
const PEOPLE_DATA_URL = "data/people-people-sync.csv";
const LOCATION_DATA_URL = "data/location-location-sync.csv";
const TAG_DATA_URL = "data/tags-tags-sync.csv";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "tif", "tiff"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const UNKNOWN_TIME_MINUTES = 24 * 60 + 1;

const dom = {
  searchInput: document.getElementById("search-input"),
  locationFilter: document.getElementById("location-filter"),
  peopleFilter: document.getElementById("people-filter"),
  mediaOnlyFilter: document.getElementById("media-only-filter"),
  resetFilters: document.getElementById("reset-filters"),
  timeline: document.getElementById("timeline"),
  imageModal: document.getElementById("image-modal"),
  modalImage: document.getElementById("modal-image"),
  modalCaption: document.getElementById("modal-caption"),
  modalClose: document.getElementById("modal-close"),
  modalPrev: document.getElementById("modal-prev"),
  modalNext: document.getElementById("modal-next"),
  recordModal: document.getElementById("record-modal"),
  recordModalClose: document.getElementById("record-modal-close"),
  recordModalKind: document.getElementById("record-modal-kind"),
  recordModalTitle: document.getElementById("record-modal-title"),
  recordModalSubtitle: document.getElementById("record-modal-subtitle"),
  recordModalContent: document.getElementById("record-modal-content"),
  emptyStateTemplate: document.getElementById("empty-state-template")
};

const state = {
  events: [],
  filteredEvents: [],
  filters: {
    search: "",
    location: "",
    person: "",
    mediaOnly: false,
    relatedEventSet: null
  },
  related: {
    person: new Map(),
    location: new Map(),
    tag: new Map()
  },
  relatedById: {
    person: new Map(),
    location: new Map(),
    tag: new Map()
  },
  modalMedia: [],
  modalIndex: 0,
  recordModalImages: [],
  recordModalRelatedEvents: []
};

init().catch((error) => {
  console.error(error);
  renderLoadError();
});

async function init() {
  bindUi();
  const [eventsCsv, peopleCsv, locationCsv, tagCsv] = await Promise.all([
    fetchCsv(DATA_URL),
    fetchOptionalCsv(PEOPLE_DATA_URL),
    fetchOptionalCsv(LOCATION_DATA_URL),
    fetchOptionalCsv(TAG_DATA_URL)
  ]);

  const rows = parseCsv(eventsCsv);
  if (rows.length < 2) {
    throw new Error("CSV appears empty.");
  }

  const records = rowsToObjects(rows);
  state.events = records.map(normalizeEvent).sort(sortEvents);
  buildRelatedIndexes({
    peopleCsv,
    locationCsv,
    tagCsv
  });
  hydrateEventLinkedReferences();

  populateFilters();
  applyFilters();
}

function bindUi() {
  dom.searchInput.addEventListener("input", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.search = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  dom.locationFilter.addEventListener("change", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.location = event.target.value;
    applyFilters();
  });

  dom.peopleFilter.addEventListener("change", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.person = event.target.value;
    applyFilters();
  });

  dom.mediaOnlyFilter.addEventListener("change", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.mediaOnly = event.target.checked;
    applyFilters();
  });

  dom.resetFilters.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.location = "";
    state.filters.person = "";
    state.filters.mediaOnly = false;
    state.filters.relatedEventSet = null;

    dom.searchInput.value = "";
    dom.locationFilter.value = "";
    dom.peopleFilter.value = "";
    dom.mediaOnlyFilter.checked = false;

    applyFilters();
  });

  dom.timeline.addEventListener("click", (event) => {
    const thumb = event.target.closest("button[data-media-group-index]");
    if (thumb) {
      event.preventDefault();
      const groupIndex = Number.parseInt(thumb.dataset.mediaGroupIndex, 10);
      const itemIndex = Number.parseInt(thumb.dataset.mediaItemIndex, 10);
      const eventData = state.filteredEvents[groupIndex];
      if (eventData && Number.isFinite(itemIndex)) {
        openModal(eventData.images, itemIndex);
      }
      return;
    }

    const recordTrigger = event.target.closest("button[data-record-kind][data-record-name]");
    if (recordTrigger) {
      event.preventDefault();
      openRecordModal(recordTrigger.dataset.recordKind, recordTrigger.dataset.recordName);
    }
  });

  dom.timeline.addEventListener(
    "toggle",
    (event) => {
      if (!event.target.matches("details.event-item")) {
        return;
      }
      if (!event.target.open || event.target.dataset.loaded === "1") {
        return;
      }
      const lazyImages = event.target.querySelectorAll("img[data-src]");
      lazyImages.forEach((image) => {
        image.src = image.dataset.src;
        image.removeAttribute("data-src");
      });
      event.target.dataset.loaded = "1";
    },
    true
  );

  dom.modalClose.addEventListener("click", () => closeModal());
  dom.modalPrev.addEventListener("click", () => shiftModal(-1));
  dom.modalNext.addEventListener("click", () => shiftModal(1));
  dom.recordModalClose.addEventListener("click", () => closeRecordModal());

  dom.recordModal.addEventListener("click", (event) => {
    const rect = dom.recordModal.getBoundingClientRect();
    const clickedOutside =
      event.clientY < rect.top ||
      event.clientY > rect.bottom ||
      event.clientX < rect.left ||
      event.clientX > rect.right;
    if (clickedOutside) {
      closeRecordModal();
    }
  });

  dom.recordModalContent.addEventListener("click", (event) => {
    const recordTrigger = event.target.closest("button[data-record-kind][data-record-name]");
    if (recordTrigger) {
      event.preventDefault();
      openRecordModal(recordTrigger.dataset.recordKind, recordTrigger.dataset.recordName);
      return;
    }

    const mediaTrigger = event.target.closest("button[data-record-media-index]");
    if (mediaTrigger) {
      event.preventDefault();
      const index = Number.parseInt(mediaTrigger.dataset.recordMediaIndex, 10);
      if (Number.isFinite(index)) {
        openModal(state.recordModalImages, index);
      }
      return;
    }

    const relatedEventTrigger = event.target.closest("button[data-related-event-name]");
    if (relatedEventTrigger) {
      event.preventDefault();
      const name = relatedEventTrigger.dataset.relatedEventName || "";
      if (!name) {
        return;
      }
      closeRecordModal();
      focusEventByName(name);
      return;
    }

    const relatedSetTrigger = event.target.closest("button[data-apply-related-events]");
    if (!relatedSetTrigger) {
      return;
    }
    event.preventDefault();
    if (state.recordModalRelatedEvents.length === 0) {
      return;
    }
    state.filters.relatedEventSet = new Set(state.recordModalRelatedEvents.map((name) => normalizeKey(name)));
    closeRecordModal();
    applyFilters();
  });

  dom.imageModal.addEventListener("click", (event) => {
    const rect = dom.imageModal.getBoundingClientRect();
    const clickedOutside =
      event.clientY < rect.top ||
      event.clientY > rect.bottom ||
      event.clientX < rect.left ||
      event.clientX > rect.right;
    if (clickedOutside) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!dom.imageModal.open) {
      if (dom.recordModal.open && event.key === "Escape") {
        closeRecordModal();
      }
      return;
    }
    if (event.key === "Escape") {
      closeModal();
    } else if (event.key === "ArrowLeft") {
      shiftModal(-1);
    } else if (event.key === "ArrowRight") {
      shiftModal(1);
    }
  });
}

async function fetchCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${url} (${response.status})`);
  }
  return response.text();
}

async function fetchOptionalCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return "";
  }
  return response.text();
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let current = "";
  let index = 0;
  let quoted = false;

  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 2;
        continue;
      }
      if (char === '"') {
        quoted = false;
        index += 1;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      row.push(current);
      current = "";
      index += 1;
      continue;
    }

    if (char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      index += 1;
      continue;
    }

    if (char === "\r") {
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  row.push(current);
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  const headers = rows[0].map((header) => header.trim());
  const body = rows.slice(1);
  return body.map((cells) => {
    const object = {};
    for (let i = 0; i < headers.length; i += 1) {
      object[headers[i]] = (cells[i] || "").trim();
    }
    return object;
  });
}

function normalizeEvent(raw, index) {
  const beginningDate = parseDateOnly(raw["Beginning Date"]);
  const timeMinutes = parseTimeToMinutes(raw.Time || raw["Time (AM/PM)"] || "");

  const allMediaAttachments = [
    ...parseAttachmentField(raw.Images, "image"),
    ...parseAttachmentField(raw["Document Images"], "image")
  ];

  const images = allMediaAttachments.filter((attachment) => attachment.type === "image");

  const people = parseList(raw["Related People & Groups"]);
  const location = sanitizeText(raw.Location || "");
  const locationFallback = sanitizeText(raw["All Related Locations"] || "");
  const peopleFallback = sanitizeText(raw["All Related People Names"] || "");
  const tags = parseList(raw.Tags);
  const description = raw.Description || "";
  const type = sanitizeText(raw.Type || "") || "Uncategorized";
  const sourceUrls = parseUrls(raw.Sources).filter((url) => !isPdfUrl(url) && !isAirtableAttachmentUrl(url));
  const links = sourceUrls.map((url, linkIndex) => ({ label: `Source ${linkIndex + 1}`, url }));

  const dateKey = beginningDate ? toDateKey(beginningDate) : "unknown-date";
  const dateLabel = beginningDate ? formatDateHeading(beginningDate) : "Unknown Date";
  const dateSummary =
    raw["Event Timing"] ||
    raw["Event Date & Time"] ||
    (beginningDate ? formatDateSummary(beginningDate) : raw["Beginning Date"] || "Unknown date");
  const dateBadge = beginningDate ? formatDateBadge(beginningDate) : raw["Beginning Date"] || "Unknown";

  const searchableText = [
    raw["Event Name"],
    description,
    location,
    people.join(" "),
    tags.join(" "),
    type,
    raw["Related Documents"],
    raw.Tags
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    index,
    eventName: raw["Event Name"] || "Untitled event",
    description,
    type,
    location,
    locationFallback,
    people,
    peopleFallback,
    tags,
    dateSummary,
    dateBadge,
    dateKey,
    dateLabel,
    sortTime: beginningDate ? beginningDate.getTime() + timeMinutes * 60_000 : Number.POSITIVE_INFINITY,
    images,
    links,
    searchableText
  };
}

function parseAttachmentField(input, hintedType) {
  const value = (input || "").trim();
  if (!value) {
    return [];
  }

  const results = [];
  const seen = new Set();
  const namedPattern = /([^,]*?)\s*\(([^)\s]+)\)/g;
  let match = namedPattern.exec(value);

  while (match) {
    const label = cleanLabel(match[1]) || "Attachment";
    const url = match[2].trim();
    pushAttachment(results, seen, label, url, hintedType);
    match = namedPattern.exec(value);
  }

  if (results.length === 0) {
    const urls = parseUrls(value);
    urls.forEach((url, idx) => {
      pushAttachment(results, seen, `${capitalize(hintedType)} ${idx + 1}`, url, hintedType);
    });
  }

  return results;
}

function pushAttachment(target, seen, label, url, hintedType) {
  if (!url || seen.has(url) || isAirtableAttachmentUrl(url)) {
    return;
  }
  seen.add(url);
  target.push({
    label,
    url,
    type: inferAttachmentType(label, url, hintedType)
  });
}

function inferAttachmentType(label, url, hintedType) {
  const fallback = hintedType === "image" ? "image" : "file";
  const value = `${label} ${url}`.toLowerCase();
  const extensionMatch = value.match(/\.([a-z0-9]+)(?:$|[?#)\s])/);
  if (!extensionMatch) {
    return fallback;
  }
  const extension = extensionMatch[1];
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }
  return fallback;
}

function cleanLabel(value) {
  return value.replace(/^"+|"+$/g, "").trim();
}

function parseList(value) {
  if (!value) {
    return [];
  }

  const items = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      const token = sanitizeText(current);
      if (token) {
        items.push(token);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const finalToken = sanitizeText(current);
  if (finalToken) {
    items.push(finalToken);
  }
  return items;
}

function parseUrls(value) {
  if (!value) {
    return [];
  }
  const found = value.match(/https?:\/\/[^\s,•]+/g) || [];
  const normalized = found.map((url) => url.replace(/[).,;]+$/g, ""));
  return [...new Set(normalized)];
}

function isPdfUrl(value) {
  return /\.pdf(?:$|[?#])/i.test(String(value || "").trim());
}

function isAirtableAttachmentUrl(value) {
  return /airtableusercontent\.com/i.test(String(value || "").trim());
}

function sanitizeText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  let result = text;
  if (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1);
  }

  result = result.replace(/""/g, '"').trim();
  result = result.replace(/^"+|"+$/g, "").trim();
  return result;
}

function normalizeKey(value) {
  return sanitizeText(value).toLowerCase();
}

function parseDateOnly(value) {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return new Date(Date.UTC(Number.parseInt(year, 10), Number.parseInt(month, 10) - 1, Number.parseInt(day, 10)));
  }

  const native = Date.parse(text);
  if (!Number.isNaN(native)) {
    const parsed = new Date(native);
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  return null;
}

function parseTimeToMinutes(value) {
  if (!value) {
    return UNKNOWN_TIME_MINUTES;
  }
  const text = value.trim().toLowerCase();
  if (!text) {
    return UNKNOWN_TIME_MINUTES;
  }

  let match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (match) {
    let hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2] || "0", 10);
    const meridiem = match[3].toLowerCase();
    if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
      if (meridiem === "pm" && hours < 12) {
        hours += 12;
      } else if (meridiem === "am" && hours === 12) {
        hours = 0;
      }
      return hours * 60 + minutes;
    }
  }

  return UNKNOWN_TIME_MINUTES;
}

function toDateKey(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateHeading(date) {
  const weekday = date.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC"
  });
  const main = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
  return `${weekday} \u2022 ${main}`;
}

function formatDateBadge(date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function formatDateSummary(date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function sortEvents(left, right) {
  if (left.sortTime !== right.sortTime) {
    return left.sortTime - right.sortTime;
  }
  return left.eventName.localeCompare(right.eventName);
}

function populateFilters() {
  const locationCounts = new Map();
  const peopleCounts = new Map();

  state.events.forEach((event) => {
    if (event.location) {
      locationCounts.set(event.location, (locationCounts.get(event.location) || 0) + 1);
    }
    event.people.forEach((person) => {
      peopleCounts.set(person, (peopleCounts.get(person) || 0) + 1);
    });
  });

  fillSelectOptions(dom.locationFilter, "All Locations", locationCounts);
  fillSelectOptions(dom.peopleFilter, "All People", peopleCounts);
}

function fillSelectOptions(select, defaultLabel, countsMap) {
  select.replaceChildren();

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = defaultLabel;
  select.append(defaultOption);

  const sorted = [...countsMap.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });

  sorted.forEach(([value, count]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value} (${count})`;
    select.append(option);
  });
}

function applyFilters() {
  const { search, location, person, mediaOnly, relatedEventSet } = state.filters;

  state.filteredEvents = state.events.filter((event) => {
    if (location && event.location !== location) {
      return false;
    }
    if (person && !event.people.includes(person)) {
      return false;
    }
    if (mediaOnly && event.images.length === 0) {
      return false;
    }
    if (search && !event.searchableText.includes(search)) {
      return false;
    }
    if (relatedEventSet && !relatedEventSet.has(normalizeKey(event.eventName))) {
      return false;
    }
    return true;
  });

  renderTimeline();
}

function renderTimeline() {
  dom.timeline.replaceChildren();

  if (state.filteredEvents.length === 0) {
    dom.timeline.append(dom.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  const grouped = [];
  let current = null;

  state.filteredEvents.forEach((event, filteredIndex) => {
    if (!current || current.key !== event.dateKey) {
      current = {
        key: event.dateKey,
        label: event.dateLabel,
        items: []
      };
      grouped.push(current);
    }
    current.items.push({ event, filteredIndex });
  });

  const fragment = document.createDocumentFragment();
  grouped.forEach((group) => {
    fragment.append(buildDateGroup(group));
  });

  dom.timeline.append(fragment);
}

function buildDateGroup(group) {
  const row = document.createElement("li");
  row.className = "date-group";

  const heading = document.createElement("h2");
  heading.className = "date-heading";

  const count = document.createElement("span");
  count.className = "date-count";
  count.textContent = `${group.items.length} ${group.items.length === 1 ? "event" : "events"}`;

  const label = document.createElement("span");
  label.className = "date-label";
  label.textContent = group.label;

  heading.append(count, label);

  const list = document.createElement("ol");
  list.className = "group-events";

  group.items.forEach(({ event, filteredIndex }) => {
    list.append(buildEventRow(event, filteredIndex));
  });

  row.append(heading, list);
  return row;
}

function buildEventRow(event, filteredIndex) {
  const row = document.createElement("li");
  row.className = "timeline-item";

  const details = document.createElement("details");
  details.className = "event-item";
  details.dataset.eventNameKey = normalizeKey(event.eventName);
  const tint = getTypeTint(event.type);
  details.style.setProperty("--record-tint-bg", tint.background);
  details.style.setProperty("--record-tint-border", tint.border);

  const summary = document.createElement("summary");
  summary.className = "event-summary";

  const summaryText = document.createElement("div");
  summaryText.className = "summary-text";

  const title = document.createElement("h3");
  title.className = "event-title";
  title.textContent = event.eventName;

  const titleActions = document.createElement("div");
  titleActions.className = "event-title-actions";

  const dateBadge = document.createElement("span");
  dateBadge.className = "event-date-badge";
  dateBadge.textContent = event.dateBadge;

  const expander = document.createElement("span");
  expander.className = "event-expander";
  expander.setAttribute("aria-hidden", "true");

  titleActions.append(dateBadge, expander);

  const titleRow = document.createElement("div");
  titleRow.className = "event-title-row";
  titleRow.append(title, titleActions);

  const fieldGrid = document.createElement("div");
  fieldGrid.className = "summary-fields";
  fieldGrid.append(
    buildSummaryField("Date", event.dateSummary),
    buildSummaryLocationField(event.location),
    buildSummaryPeopleField(event.people)
  );

  summaryText.append(titleRow, fieldGrid);

  const summaryTop = document.createElement("div");
  summaryTop.className = "summary-top";
  summaryTop.append(summaryText);

  if (event.images.length > 0) {
    const summaryThumbButton = document.createElement("button");
    summaryThumbButton.type = "button";
    summaryThumbButton.className = "summary-thumb-button";
    summaryThumbButton.dataset.mediaGroupIndex = String(filteredIndex);
    summaryThumbButton.dataset.mediaItemIndex = "0";
    summaryThumbButton.setAttribute("aria-label", `Open primary image for ${event.eventName}`);

    const summaryThumb = document.createElement("img");
    summaryThumb.className = "summary-thumb";
    summaryThumb.loading = "lazy";
    summaryThumb.src = event.images[0].url;
    summaryThumb.alt = event.images[0].label;

    summaryThumbButton.append(summaryThumb);
    summaryTop.append(summaryThumbButton);
  }

  summary.append(summaryTop);

  const content = document.createElement("div");
  content.className = "event-content";

  if (event.description) {
    const description = renderRichTextBlock(event.description, "event-description");
    content.append(description);
  }

  if (event.images.length) {
    content.append(buildImageGallery(event.images, filteredIndex));
  }

  if (event.tags.length) {
    content.append(buildTagSection(event.tags));
  }

  if (event.links.length) {
    const links = document.createElement("div");
    links.className = "links-row";
    event.links.forEach((link) => {
      const anchor = document.createElement("a");
      anchor.className = "link-pill";
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = link.label;
      links.append(anchor);
    });
    content.append(links);
  }

  details.append(summary, content);
  row.append(details);
  return row;
}

function buildSummaryField(label, value) {
  const item = document.createElement("div");
  item.className = "summary-field";

  const key = document.createElement("span");
  key.className = "summary-label";
  key.textContent = `${label}:`;

  const fieldValue = document.createElement("span");
  fieldValue.className = "summary-value";
  fieldValue.textContent = value || "-";

  item.append(key, fieldValue);
  return item;
}

function buildSummaryLocationField(location) {
  const item = document.createElement("div");
  item.className = "summary-field";

  const key = document.createElement("span");
  key.className = "summary-label";
  key.textContent = "Location:";
  item.append(key);

  if (!location) {
    const empty = document.createElement("span");
    empty.className = "summary-value";
    empty.textContent = "-";
    item.append(empty);
    return item;
  }

  item.append(buildRecordChip(location, "location", location, true));
  return item;
}

function buildSummaryPeopleField(people) {
  const item = document.createElement("div");
  item.className = "summary-field";

  const key = document.createElement("span");
  key.className = "summary-label";
  key.textContent = "People:";
  item.append(key);

  if (people.length === 0) {
    const empty = document.createElement("span");
    empty.className = "summary-value";
    empty.textContent = "-";
    item.append(empty);
    return item;
  }

  const wrap = document.createElement("span");
  wrap.className = "summary-chip-wrap";

  const visiblePeople = people.slice(0, 2);
  visiblePeople.forEach((person) => {
    wrap.append(buildRecordChip(person, "person", person, true));
  });

  if (people.length > visiblePeople.length) {
    const overflow = document.createElement("span");
    overflow.className = "summary-overflow";
    overflow.textContent = `+${people.length - visiblePeople.length} more`;
    wrap.append(overflow);
  }

  item.append(wrap);
  return item;
}

function buildTagSection(tags) {
  const section = document.createElement("section");
  section.className = "tag-section";

  const heading = document.createElement("h4");
  heading.className = "tag-heading";
  heading.textContent = `Tags (${tags.length})`;
  section.append(heading);

  const wrap = document.createElement("div");
  wrap.className = "tag-list";
  tags.forEach((tag) => {
    wrap.append(buildRecordChip(tag, "tag", tag));
  });
  section.append(wrap);
  return section;
}

function buildRecordChip(label, kind, value, compact = false) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `filter-chip ${kind}-chip`;
  if (compact) {
    chip.classList.add("summary-chip");
  }
  chip.textContent = label;
  chip.dataset.recordKind = kind;
  chip.dataset.recordName = value;

  return chip;
}

function getTypeTint(type) {
  const text = (type || "uncategorized").toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }

  const hue = hash;
  return {
    background: `hsl(${hue} 25% 97%)`,
    border: `hsl(${hue} 22% 72%)`
  };
}

function buildRelatedIndexes({ peopleCsv, locationCsv, tagCsv }) {
  const eventNameLookup = new Map();
  state.events.forEach((event) => {
    eventNameLookup.set(normalizeKey(event.eventName), event.eventName);
  });

  state.related.person = buildPersonIndex(peopleCsv, eventNameLookup);
  state.related.location = buildLocationIndex(locationCsv, eventNameLookup);
  state.related.tag = buildTagIndex(tagCsv, eventNameLookup);

  state.relatedById.person = buildIdLookup(peopleCsv, ["People Record ID"], ["Full Name"]);
  state.relatedById.location = buildIdLookup(locationCsv, ["Location Record ID"], ["Location"]);
  state.relatedById.tag = buildIdLookup(tagCsv, ["Tag Record ID", "Documents Record ID"], ["Tag"]);
}

function buildIdLookup(csvText, idFields, nameFields) {
  const lookup = new Map();
  rowsFromOptionalCsv(csvText).forEach((row) => {
    const name = firstField(row, nameFields);
    const recordId = firstField(row, idFields);
    if (!name || !recordId) {
      return;
    }
    lookup.set(normalizeKey(recordId), name);
  });
  return lookup;
}

function firstField(row, fields) {
  for (const field of fields) {
    const value = sanitizeText(row[field]);
    if (value) {
      return value;
    }
  }
  return "";
}

function hydrateEventLinkedReferences() {
  state.events = state.events.map((event) => {
    const resolvedLocation = resolveLinkedName("location", event.location);
    const location = resolvedLocation || event.locationFallback || "";

    const resolvedPeople = uniqueCompact(event.people.map((person) => resolveLinkedName("person", person)));
    const fallbackPeople = parseLinkedValues(event.peopleFallback, "person");
    const people = resolvedPeople.length > 0 ? resolvedPeople : uniqueCompact(fallbackPeople);
    const tags = uniqueCompact(event.tags.map((tag) => resolveLinkedName("tag", tag)));
    const searchableText = [event.searchableText, location, people.join(" "), tags.join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return {
      ...event,
      location,
      people,
      tags,
      searchableText
    };
  });
}

function uniqueCompact(values) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const clean = sanitizeText(value);
    if (!clean) {
      return;
    }
    const key = normalizeKey(clean);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(clean);
  });
  return result;
}

function isRecordId(value) {
  return /^rec[a-z0-9]{10,}$/i.test(sanitizeText(value));
}

function resolveLinkedName(kind, value) {
  const text = sanitizeText(value);
  if (!text) {
    return "";
  }
  if (!isRecordId(text)) {
    return text;
  }
  const resolved = state.relatedById[kind]?.get(normalizeKey(text));
  return resolved || "";
}

function resolveRecordLookupKey(kind, nameOrId) {
  const text = sanitizeText(nameOrId);
  if (!text) {
    return "";
  }
  if (isRecordId(text)) {
    const resolved = state.relatedById[kind]?.get(normalizeKey(text));
    if (resolved) {
      return normalizeKey(resolved);
    }
  }
  return normalizeKey(text);
}

function rowsFromOptionalCsv(csvText) {
  if (!csvText) {
    return [];
  }
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return [];
  }
  return rowsToObjects(rows);
}

function buildPersonIndex(csvText, eventNameLookup) {
  const index = new Map();
  rowsFromOptionalCsv(csvText).forEach((row) => {
    const name = sanitizeText(row["Full Name"]);
    if (!name) {
      return;
    }

    const attachments = parseAttachmentField(row.Image, "image");
    const downloads = [
      ...attachments.filter((item) => item.type !== "image" && item.type !== "pdf"),
      ...buildLinkDownloads(
        parseUrls(row.Sources).filter((url) => !isPdfUrl(url) && !isAirtableAttachmentUrl(url)),
        "Source"
      )
    ].filter((item) => item.type !== "pdf");

    index.set(normalizeKey(name), {
      kind: "person",
      name,
      slug: sanitizeText(row.Slug),
      subtitle: sanitizeText(row["Role in Case"]),
      summary: sanitizeText(row["Short Bio"] || row.Biography),
      images: attachments.filter((item) => item.type === "image"),
      downloads,
      relatedRecords: {
        person: uniqueCompact(
          resolveRelatedNames("person", [
            row["Member Of / Linked Beneath"],
            row["Members of Group"],
            row.Relatives,
            row["From field: Relatives"]
          ]).filter((person) => normalizeKey(person) !== normalizeKey(name))
        ),
        location: resolveRelatedNames("location", [row["Locations Linked To"], row["Locations via Events"]]),
        tag: resolveRelatedNames("tag", [row["Related Tags"]])
      },
      relatedEvents: resolveRelatedEvents(parseList(row["Related Events"]), eventNameLookup),
      details: [
        makeDetail("Born", row["Date of Birth"]),
        makeDetail("Died", row["Date of Death"]),
        makeDetail("Home / HQ", row["Home / Headquarters"]),
        makeDetail("Role Score", row["Role in Case Score"])
      ].filter(Boolean)
    });
  });
  return index;
}

function buildLocationIndex(csvText, eventNameLookup) {
  const index = new Map();
  rowsFromOptionalCsv(csvText).forEach((row) => {
    const name = sanitizeText(row.Location);
    if (!name) {
      return;
    }

    const attachments = parseAttachmentField(row.Images, "image");
    const mapLinks = parseUrls(row["Google Maps"] || row["Lat/Lon Google Maps URL"]).filter(
      (url) => !isAirtableAttachmentUrl(url)
    );
    const downloads = [
      ...attachments.filter((item) => item.type !== "image" && item.type !== "pdf"),
      ...buildLinkDownloads(mapLinks, "Map")
    ].filter((item) => item.type !== "pdf");

    index.set(normalizeKey(name), {
      kind: "location",
      name,
      slug: sanitizeText(row.Slug),
      subtitle: sanitizeText(row.Type),
      summary: sanitizeText(row.Notes),
      images: attachments.filter((item) => item.type === "image"),
      downloads,
      relatedRecords: {
        person: resolveRelatedNames("person", [row["People / Orgs Linked To"], row["All Related People Names"]]),
        location: uniqueCompact(
          resolveRelatedNames("location", [
            row["Related Locations"],
            row["All Related Locations"],
            row["Related Locations Rollup"],
            row["All Related Locations Rollup (from Located Within)"]
          ]).filter((location) => normalizeKey(location) !== normalizeKey(name))
        ),
        tag: resolveRelatedNames("tag", [row.Tags])
      },
      relatedEvents: resolveRelatedEvents(parseList(row.Events), eventNameLookup),
      details: [
        makeDetail("Address", row.Address),
        makeDetail("Located Within", row["Located Within"]),
        makeDetail("Latitude", row.Latitude),
        makeDetail("Longitude", row.Longitude)
      ].filter(Boolean)
    });
  });
  return index;
}

function buildTagIndex(csvText, eventNameLookup) {
  const index = new Map();
  rowsFromOptionalCsv(csvText).forEach((row) => {
    const name = sanitizeText(row.Tag);
    if (!name) {
      return;
    }

    const attachments = parseAttachmentField(row["Document Images"], "image");
    const downloads = [
      ...attachments.filter((item) => item.type !== "image" && item.type !== "pdf"),
      ...buildLinkDownloads(
        parseUrls(row.Documents).filter((url) => !isPdfUrl(url) && !isAirtableAttachmentUrl(url)),
        "Document"
      )
    ].filter((item) => item.type !== "pdf");

    index.set(normalizeKey(name), {
      kind: "tag",
      name,
      slug: sanitizeText(row.Slug),
      subtitle: sanitizeText(row["Tagged Under"] || row["AI: Information Category (Detailed)"]),
      summary: sanitizeText(row.Summary || row["AI: Summary Analysis"]),
      images: attachments.filter((item) => item.type === "image"),
      downloads,
      relatedRecords: {
        person: resolveRelatedNames("person", [row["Related People"], row["Related People Names"]]),
        location: resolveRelatedNames("location", [row.Locations]),
        tag: resolveRelatedNames("tag", [row["Tagged Under"]]).filter(
          (tag) => normalizeKey(tag) !== normalizeKey(name)
        )
      },
      relatedEvents: resolveRelatedEvents(
        parseList(row["Related Event Names"] || row["Related Events"]),
        eventNameLookup
      ),
      details: [
        makeDetail("Date", row.Date),
        makeDetail("Documents", row["Related Documents"])
      ].filter(Boolean)
    });
  });
  return index;
}

function makeDetail(label, value) {
  const text = sanitizeText(value);
  if (!text) {
    return null;
  }
  return { label, value: text };
}

function buildLinkDownloads(urls, labelPrefix) {
  return urls.map((url, index) => ({
    label: `${labelPrefix} ${index + 1}`,
    url,
    type: inferAttachmentType(`${labelPrefix} ${index + 1}`, url, "file")
  }));
}

function resolveRelatedEvents(names, eventNameLookup) {
  const resolved = [];
  const seen = new Set();
  names.forEach((name) => {
    const clean = sanitizeText(name);
    if (!clean) {
      return;
    }
    const canonical = eventNameLookup.get(normalizeKey(clean)) || clean;
    const key = normalizeKey(canonical);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    resolved.push(canonical);
  });
  return resolved;
}

function openRecordModal(kind, name) {
  const lookup = state.related[kind];
  const lookupKey = resolveRecordLookupKey(kind, name);
  const record = lookup ? lookup.get(lookupKey) || buildFallbackRecord(kind, name) : buildFallbackRecord(kind, name);

  state.recordModalImages = record.images;
  state.recordModalRelatedEvents = record.relatedEvents;
  dom.recordModalKind.textContent = record.kind.toUpperCase();
  dom.recordModalTitle.textContent = record.name;
  dom.recordModalSubtitle.textContent = record.subtitle || "";
  dom.recordModalSubtitle.hidden = !record.subtitle;

  const content = dom.recordModalContent;
  content.replaceChildren();

  if (record.summary) {
    const summary = renderRichTextBlock(record.summary, "record-summary");
    content.append(summary);
  }

  if (record.details.length) {
    const details = document.createElement("dl");
    details.className = "record-details";
    record.details.forEach((entry) => {
      const dt = document.createElement("dt");
      dt.textContent = entry.label;
      const dd = document.createElement("dd");
      dd.textContent = entry.value;
      details.append(dt, dd);
    });
    content.append(details);
  }

  if (record.images.length) {
    content.append(buildRecordImageSection(record.images));
  }

  if (record.downloads.length) {
    content.append(buildRecordDownloadSection(record.downloads));
  }

  content.append(buildRecordConnectionsSection(record.relatedRecords));
  content.append(buildRelatedEventsSection(record.relatedEvents));
  dom.recordModal.showModal();
}

function buildFallbackRecord(kind, name) {
  const cleanName = resolveLinkedName(kind, name) || "";
  const fallbackName =
    cleanName ||
    (kind === "person" ? "Unknown Person" : kind === "location" ? "Unknown Location" : "Unknown Tag");
  const relatedEvents = state.events
    .filter((event) => {
      if (kind === "person") {
        return event.people.some((person) => normalizeKey(person) === normalizeKey(fallbackName));
      }
      if (kind === "location") {
        return normalizeKey(event.location) === normalizeKey(fallbackName);
      }
      if (kind === "tag") {
        return event.tags.some((tag) => normalizeKey(tag) === normalizeKey(fallbackName));
      }
      return false;
    })
    .map((event) => event.eventName);

  return {
    kind,
    name: fallbackName,
    subtitle: "Record details unavailable in synced table",
    summary: "",
    details: [],
    images: [],
    downloads: [],
    relatedRecords: {
      person: [],
      location: [],
      tag: []
    },
    relatedEvents
  };
}

function buildRecordConnectionsSection(relatedRecords) {
  const groups = [
    { kind: "person", label: "People", values: relatedRecords?.person || [] },
    { kind: "location", label: "Locations", values: relatedRecords?.location || [] },
    { kind: "tag", label: "Tags", values: relatedRecords?.tag || [] }
  ].filter((group) => group.values.length > 0);

  if (groups.length === 0) {
    return document.createDocumentFragment();
  }

  const section = document.createElement("section");
  section.className = "record-section";

  groups.forEach((group) => {
    const heading = document.createElement("h3");
    heading.className = "record-section-title";
    heading.textContent = `${group.label} (${group.values.length})`;
    section.append(heading);

    const list = document.createElement("div");
    list.className = "record-related-list";
    group.values.forEach((value) => {
      list.append(buildRecordChip(value, group.kind, value));
    });
    section.append(list);
  });

  return section;
}

function buildRecordImageSection(images) {
  const section = document.createElement("section");
  section.className = "record-section";

  const heading = document.createElement("h3");
  heading.className = "record-section-title";
  heading.textContent = `Images (${images.length})`;
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "record-image-grid";
  images.forEach((image, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-image-button";
    button.dataset.recordMediaIndex = String(index);

    const thumbnail = document.createElement("img");
    thumbnail.loading = "lazy";
    thumbnail.src = image.url;
    thumbnail.alt = image.label;

    const label = document.createElement("span");
    label.className = "record-image-label";
    label.textContent = image.label;

    button.append(thumbnail, label);
    grid.append(button);
  });
  section.append(grid);
  return section;
}

function buildRecordDownloadSection(downloads) {
  const section = document.createElement("section");
  section.className = "record-section";

  const heading = document.createElement("h3");
  heading.className = "record-section-title";
  heading.textContent = `Downloads (${downloads.length})`;
  section.append(heading);

  const list = document.createElement("ul");
  list.className = "record-download-list";
  downloads.forEach((download) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "record-download-link";
    link.href = download.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.download = "";
    link.textContent = download.label;
    item.append(link);
    list.append(item);
  });
  section.append(list);
  return section;
}

function buildRelatedEventsSection(eventNames) {
  const section = document.createElement("section");
  section.className = "record-section";

  const heading = document.createElement("h3");
  heading.className = "record-section-title";
  heading.textContent = `Related Events (${eventNames.length})`;
  section.append(heading);

  if (eventNames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "record-empty";
    empty.textContent = "No related timeline events in this dataset.";
    section.append(empty);
    return section;
  }

  const filterButton = document.createElement("button");
  filterButton.type = "button";
  filterButton.className = "record-related-filter";
  filterButton.dataset.applyRelatedEvents = "1";
  filterButton.textContent = "Filter Timeline To These Events";
  section.append(filterButton);

  const list = document.createElement("div");
  list.className = "record-related-list";
  eventNames.forEach((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-related-event";
    button.dataset.relatedEventName = name;
    button.textContent = name;
    list.append(button);
  });
  section.append(list);
  return section;
}

function closeRecordModal() {
  if (dom.recordModal.open) {
    dom.recordModal.close();
  }
}

function focusEventByName(eventName) {
  const name = sanitizeText(eventName);
  if (!name) {
    return;
  }

  state.filters.relatedEventSet = null;
  state.filters.search = name.toLowerCase();
  dom.searchInput.value = name;
  applyFilters();
}

function buildImageGallery(images, filteredIndex) {
  const section = document.createElement("section");
  section.className = "images-section";

  const heading = document.createElement("h4");
  heading.className = "images-heading";
  heading.textContent = `Images (${images.length})`;
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "media-grid";

  images.forEach((image, itemIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button";
    button.dataset.mediaGroupIndex = String(filteredIndex);
    button.dataset.mediaItemIndex = String(itemIndex);

    const thumbnail = document.createElement("img");
    thumbnail.alt = image.label;
    thumbnail.loading = "lazy";
    thumbnail.dataset.src = image.url;

    const label = document.createElement("span");
    label.className = "thumb-label";
    label.textContent = image.label;

    button.append(thumbnail, label);
    grid.append(button);
  });

  section.append(grid);
  return section;
}

function resolveRelatedNames(kind, values) {
  const output = [];
  values.forEach((raw) => {
    parseLinkedValues(raw, kind).forEach((value) => {
      const resolved = resolveLinkedName(kind, value);
      if (resolved) {
        output.push(resolved);
      }
    });
  });
  return uniqueCompact(output);
}

function parseLinkedValues(value, kind) {
  const text = sanitizeText(value);
  if (!text) {
    return [];
  }

  const parsed = parseList(text);
  if (parsed.length <= 1) {
    return parsed.length ? parsed : [text];
  }

  const containsRecordIds = parsed.some((item) => isRecordId(item));
  if (!containsRecordIds && kind === "location") {
    return [text];
  }

  return parsed;
}

function renderRichTextBlock(input, className) {
  const root = document.createElement("div");
  root.className = className;

  const normalized = String(input || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) {
    return root;
  }

  const blocks = normalized.split(/\n{2,}/);
  blocks.forEach((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const headingMatch = lines[0].match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch && lines.length === 1) {
      const level = Math.min(6, headingMatch[1].length + 2);
      const heading = document.createElement(`h${level}`);
      appendRichInline(heading, headingMatch[2]);
      root.append(heading);
      return;
    }

    const listItems = lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^\s*[-*]\s+(.+)$/))
      .filter(Boolean);

    if (listItems.length === lines.filter((line) => line.trim().length > 0).length && listItems.length > 0) {
      const list = document.createElement("ul");
      listItems.forEach((match) => {
        const item = document.createElement("li");
        appendRichInline(item, match[1]);
        list.append(item);
      });
      root.append(list);
      return;
    }

    const paragraph = document.createElement("p");
    lines.forEach((line, index) => {
      if (index > 0) {
        paragraph.append(document.createElement("br"));
      }
      appendRichInline(paragraph, line);
    });
    root.append(paragraph);
  });

  return root;
}

function appendRichInline(target, text) {
  const tokenPattern = /\[([^\]]+)\]\s*\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s]+)/gi;
  let cursor = 0;
  let match = tokenPattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      appendStrongEmphasis(target, text.slice(cursor, match.index));
    }

    const markdownLabel = match[1];
    const markdownUrl = match[2];
    const rawUrl = match[3];
    const url = sanitizeUrl(markdownUrl || rawUrl || "");

    if (url) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = markdownLabel || stripTrailingUrlPunctuation(rawUrl || "");
      target.append(anchor);
    } else {
      appendStrongEmphasis(target, match[0]);
    }

    cursor = tokenPattern.lastIndex;
    match = tokenPattern.exec(text);
  }

  if (cursor < text.length) {
    appendStrongEmphasis(target, text.slice(cursor));
  }
}

function appendStrongEmphasis(target, text) {
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      target.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (match[1]) {
      const strong = document.createElement("strong");
      strong.textContent = match[1];
      target.append(strong);
    } else if (match[2]) {
      const em = document.createElement("em");
      em.textContent = match[2];
      target.append(em);
    }

    cursor = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    target.append(document.createTextNode(text.slice(cursor)));
  }
}

function sanitizeUrl(value) {
  const clean = stripTrailingUrlPunctuation(String(value || "").trim());
  if (!clean) {
    return "";
  }

  try {
    const parsed = new URL(clean);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (error) {
    return "";
  }

  return "";
}

function stripTrailingUrlPunctuation(url) {
  return String(url || "").replace(/[),.;!?]+$/g, "");
}

function openModal(mediaItems, index) {
  if (!mediaItems.length) {
    return;
  }
  state.modalMedia = mediaItems;
  state.modalIndex = index;
  renderModal();
  dom.imageModal.showModal();
}

function closeModal() {
  if (dom.imageModal.open) {
    dom.imageModal.close();
  }
}

function shiftModal(direction) {
  if (!state.modalMedia.length) {
    return;
  }
  const total = state.modalMedia.length;
  state.modalIndex = (state.modalIndex + direction + total) % total;
  renderModal();
}

function renderModal() {
  const item = state.modalMedia[state.modalIndex];
  if (!item) {
    return;
  }
  dom.modalImage.src = item.url;
  dom.modalImage.alt = item.label;
  dom.modalCaption.textContent = `${item.label} (${state.modalIndex + 1}/${state.modalMedia.length})`;
}

function renderLoadError() {
  dom.timeline.replaceChildren();
  const errorItem = document.createElement("li");
  errorItem.className = "empty-state";

  const title = document.createElement("h2");
  title.textContent = "Could not load timeline data.";

  const message = document.createElement("p");
  message.textContent = "Check that data/events-timeline.csv exists and reload.";

  errorItem.append(title, message);
  dom.timeline.append(errorItem);
}

function capitalize(value) {
  if (!value) {
    return "Attachment";
  }
  return value[0].toUpperCase() + value.slice(1);
}
