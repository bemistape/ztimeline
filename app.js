const DATA_URL = "data/events-timeline.csv";
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
  emptyStateTemplate: document.getElementById("empty-state-template")
};

const state = {
  events: [],
  filteredEvents: [],
  filters: {
    search: "",
    location: "",
    person: "",
    mediaOnly: false
  },
  modalMedia: [],
  modalIndex: 0
};

init().catch((error) => {
  console.error(error);
  renderLoadError();
});

async function init() {
  bindUi();
  const csvText = await fetchCsv();
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error("CSV appears empty.");
  }

  const records = rowsToObjects(rows);
  state.events = records.map(normalizeEvent).sort(sortEvents);

  populateFilters();
  applyFilters();
}

function bindUi() {
  dom.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  dom.locationFilter.addEventListener("change", (event) => {
    state.filters.location = event.target.value;
    applyFilters();
  });

  dom.peopleFilter.addEventListener("change", (event) => {
    state.filters.person = event.target.value;
    applyFilters();
  });

  dom.mediaOnlyFilter.addEventListener("change", (event) => {
    state.filters.mediaOnly = event.target.checked;
    applyFilters();
  });

  dom.resetFilters.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.location = "";
    state.filters.person = "";
    state.filters.mediaOnly = false;

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

    const locationTrigger = event.target.closest("button[data-filter-location]");
    if (locationTrigger) {
      event.preventDefault();
      const location = locationTrigger.dataset.filterLocation || "";
      state.filters.location = location;
      dom.locationFilter.value = location;
      applyFilters();
      return;
    }

    const personTrigger = event.target.closest("button[data-filter-person]");
    if (personTrigger) {
      event.preventDefault();
      const person = personTrigger.dataset.filterPerson || "";
      state.filters.person = person;
      dom.peopleFilter.value = person;
      applyFilters();
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

async function fetchCsv() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${DATA_URL} (${response.status})`);
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
  const imagePdfLinks = allMediaAttachments.filter((attachment) => attachment.type === "pdf");

  const people = parseList(raw["Related People & Groups"]);
  const location = sanitizeText(raw.Location || "");
  const description = raw.Description || "";
  const type = sanitizeText(raw.Type || "") || "Uncategorized";
  const sourceUrls = parseUrls(raw.Sources);
  const links = sourceUrls.map((url, linkIndex) => ({ label: `Source ${linkIndex + 1}`, url }));

  const dateKey = beginningDate ? toDateKey(beginningDate) : "unknown-date";
  const dateLabel = beginningDate ? formatDateHeading(beginningDate) : "Unknown Date";
  const dateSummary =
    raw["Event Timing"] ||
    raw["Event Date & Time"] ||
    (beginningDate ? formatDateSummary(beginningDate) : raw["Beginning Date"] || "Unknown date");

  const searchableText = [
    raw["Event Name"],
    description,
    location,
    people.join(" "),
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
    people,
    dateSummary,
    dateKey,
    dateLabel,
    sortTime: beginningDate ? beginningDate.getTime() + timeMinutes * 60_000 : Number.POSITIVE_INFINITY,
    images,
    imagePdfLinks,
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
  if (!url || seen.has(url)) {
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
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
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
  const { search, location, person, mediaOnly } = state.filters;

  state.filteredEvents = state.events.filter((event) => {
    if (location && event.location !== location) {
      return false;
    }
    if (person && !event.people.includes(person)) {
      return false;
    }
    if (mediaOnly && event.images.length === 0 && event.imagePdfLinks.length === 0) {
      return false;
    }
    if (search && !event.searchableText.includes(search)) {
      return false;
    }
    return true;
  });

  assignTimelinePositions(state.filteredEvents);
  renderTimeline();
}

function assignTimelinePositions(events) {
  const finiteTimes = events.map((event) => event.sortTime).filter((value) => Number.isFinite(value));
  if (finiteTimes.length === 0) {
    events.forEach((event) => {
      event.timelinePercent = null;
    });
    return;
  }

  const min = Math.min(...finiteTimes);
  const max = Math.max(...finiteTimes);
  events.forEach((event) => {
    if (!Number.isFinite(event.sortTime)) {
      event.timelinePercent = null;
      return;
    }
    if (max === min) {
      event.timelinePercent = 0.5;
      return;
    }
    event.timelinePercent = (event.sortTime - min) / (max - min);
  });
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
  heading.textContent = `${group.label} (${group.items.length})`;

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

  const fieldGrid = document.createElement("div");
  fieldGrid.className = "summary-fields";
  fieldGrid.append(
    buildSummaryField("Date", event.dateSummary),
    buildSummaryLocationField(event.location),
    buildSummaryPeopleField(event.people)
  );

  summaryText.append(title, fieldGrid, buildTimeBar(event));

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
    const description = document.createElement("p");
    description.className = "event-description";
    description.textContent = event.description;
    content.append(description);
  }

  if (event.images.length) {
    content.append(buildImageGallery(event.images, filteredIndex));
  }

  if (event.imagePdfLinks.length) {
    content.append(buildPdfDownloads(event.imagePdfLinks));
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

function buildTimeBar(event) {
  const wrap = document.createElement("div");
  wrap.className = "time-bar";
  if (event.timelinePercent == null) {
    return wrap;
  }

  const progress = document.createElement("span");
  progress.className = "time-bar-progress";
  const dot = document.createElement("span");
  dot.className = "time-bar-dot";

  const percent = Math.max(0, Math.min(100, event.timelinePercent * 100));
  progress.style.width = `${percent}%`;
  dot.style.left = `${percent}%`;

  wrap.append(progress, dot);
  return wrap;
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

  item.append(buildFilterChip(location, "location", location, true));
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
    wrap.append(buildFilterChip(person, "person", person, true));
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

function buildFilterChip(label, kind, value, compact = false) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `filter-chip ${kind === "location" ? "location-chip" : "people-chip"}`;
  if (compact) {
    chip.classList.add("summary-chip");
  }
  chip.textContent = label;

  if (kind === "location") {
    chip.dataset.filterLocation = value;
  } else {
    chip.dataset.filterPerson = value;
  }

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

function buildPdfDownloads(pdfs) {
  const section = document.createElement("section");
  section.className = "pdf-section";

  const heading = document.createElement("h4");
  heading.className = "pdf-heading";
  heading.textContent = `PDF Downloads (${pdfs.length})`;
  section.append(heading);

  const list = document.createElement("ul");
  list.className = "pdf-list";

  pdfs.forEach((pdf) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "pdf-link";
    link.href = pdf.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.download = "";
    link.textContent = pdf.label;
    item.append(link);
    list.append(item);
  });

  section.append(list);
  return section;
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
