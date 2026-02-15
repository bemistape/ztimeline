const DATA_URL = "data/events-timeline.csv";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "tif", "tiff"]);
const UNKNOWN_TIME_MINUTES = 24 * 60 + 1;

const dom = {
  datasetStatus: document.getElementById("dataset-status"),
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
  setStatus("Could not load timeline data.", false);
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

  setStatus(`Loaded ${state.events.length} events.`, true);
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

  const images = [
    ...parseAttachmentField(raw.Images, "image"),
    ...parseAttachmentField(raw["Document Images"], "image")
  ].filter((attachment) => attachment.type === "image");

  const tags = parseList(raw.Tags);
  const people = parseList(raw["Related People & Groups"]);
  const location = (raw.Location || "").trim();
  const description = raw.Description || "";
  const sourceUrls = parseUrls(raw.Sources);
  const links = sourceUrls.map((url, linkIndex) => ({ label: `Source ${linkIndex + 1}`, url }));

  const dateKey = beginningDate ? toDateKey(beginningDate) : "unknown-date";
  const dateLabel = beginningDate ? formatDateHeading(beginningDate) : "Unknown Date";
  const displayTiming = raw["Event Timing"] || raw["Event Date & Time"] || raw["Beginning Date"] || "Unknown time";

  const searchableText = [
    raw["Event Name"],
    description,
    location,
    raw.Tags,
    raw["Related People & Groups"],
    raw["Related Documents"],
    raw.Type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    index,
    id: `event-${index + 1}`,
    eventName: raw["Event Name"] || "Untitled event",
    description,
    location,
    people,
    tags,
    displayTiming,
    beginningDate,
    dateKey,
    dateLabel,
    sortTime: beginningDate ? beginningDate.getTime() + timeMinutes * 60_000 : Number.POSITIVE_INFINITY,
    links,
    images,
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
  return fallback;
}

function cleanLabel(value) {
  return value.replace(/^"+|"+$/g, "").trim();
}

function parseList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUrls(value) {
  if (!value) {
    return [];
  }
  const found = value.match(/https?:\/\/[^\s,•]+/g) || [];
  const normalized = found.map((url) => url.replace(/[).,;]+$/g, ""));
  return [...new Set(normalized)];
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
    if (mediaOnly && event.images.length === 0) {
      return false;
    }
    if (search && !event.searchableText.includes(search)) {
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

  const summary = document.createElement("summary");
  summary.className = "event-summary";

  const summaryText = document.createElement("div");
  summaryText.className = "summary-text";

  const title = document.createElement("h3");
  title.className = "event-title";
  title.textContent = event.eventName;

  const when = document.createElement("p");
  when.className = "event-time";
  when.textContent = event.displayTiming;

  summaryText.append(title, when);

  summary.append(summaryText);

  if (event.images.length) {
    const leadButton = document.createElement("button");
    leadButton.type = "button";
    leadButton.className = "lead-thumb-button";
    leadButton.dataset.mediaGroupIndex = String(filteredIndex);
    leadButton.dataset.mediaItemIndex = "0";
    leadButton.setAttribute("aria-label", `Open primary image for ${event.eventName}`);

    const leadImage = document.createElement("img");
    leadImage.className = "lead-thumb";
    leadImage.loading = "lazy";
    leadImage.src = event.images[0].url;
    leadImage.alt = event.images[0].label;

    leadButton.append(leadImage);
    summary.append(leadButton);
  }

  const content = document.createElement("div");
  content.className = "event-content";

  if (event.location || event.people.length) {
    const meta = document.createElement("div");
    meta.className = "meta-row";

    if (event.location) {
      meta.append(buildFilterChip(event.location, "location", event.location));
    }

    event.people.slice(0, 12).forEach((person) => {
      meta.append(buildFilterChip(person, "person", person));
    });

    content.append(meta);
  }

  if (event.description) {
    const description = document.createElement("p");
    description.className = "event-description";
    description.textContent = event.description;
    content.append(description);
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

  if (event.images.length) {
    content.append(buildImageGallery(event.images, filteredIndex));
  }

  details.append(summary, content);
  row.append(details);
  return row;
}

function buildFilterChip(label, kind, value) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `filter-chip ${kind === "location" ? "location-chip" : "people-chip"}`;
  chip.textContent = kind === "location" ? `Location: ${label}` : label;

  if (kind === "location") {
    chip.dataset.filterLocation = value;
  } else {
    chip.dataset.filterPerson = value;
  }

  return chip;
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

function setStatus(message, ok) {
  dom.datasetStatus.textContent = message;
  dom.datasetStatus.classList.toggle("status-ok", Boolean(ok));
  dom.datasetStatus.classList.toggle("status-pending", !ok);
}

function capitalize(value) {
  if (!value) {
    return "Attachment";
  }
  return value[0].toUpperCase() + value.slice(1);
}
