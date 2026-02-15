const DATA_URL = "data/events-timeline.csv";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "tif", "tiff"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

const dom = {
  datasetStatus: document.getElementById("dataset-status"),
  searchInput: document.getElementById("search-input"),
  typeFilter: document.getElementById("type-filter"),
  yearFilter: document.getElementById("year-filter"),
  mediaOnlyFilter: document.getElementById("media-only-filter"),
  resetFilters: document.getElementById("reset-filters"),
  visibleEvents: document.getElementById("visible-events"),
  visibleImages: document.getElementById("visible-images"),
  visiblePdfs: document.getElementById("visible-pdfs"),
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
    type: "",
    year: "",
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

  dom.typeFilter.addEventListener("change", (event) => {
    state.filters.type = event.target.value;
    applyFilters();
  });

  dom.yearFilter.addEventListener("change", (event) => {
    state.filters.year = event.target.value;
    applyFilters();
  });

  dom.mediaOnlyFilter.addEventListener("change", (event) => {
    state.filters.mediaOnly = event.target.checked;
    applyFilters();
  });

  dom.resetFilters.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.type = "";
    state.filters.year = "";
    state.filters.mediaOnly = false;
    dom.searchInput.value = "";
    dom.typeFilter.value = "";
    dom.yearFilter.value = "";
    dom.mediaOnlyFilter.checked = false;
    applyFilters();
  });

  dom.timeline.addEventListener("click", (event) => {
    const thumb = event.target.closest("button[data-media-group-index]");
    if (thumb) {
      const groupIndex = Number.parseInt(thumb.dataset.mediaGroupIndex, 10);
      const itemIndex = Number.parseInt(thumb.dataset.mediaItemIndex, 10);
      const eventData = state.filteredEvents[groupIndex];
      if (eventData && Number.isFinite(itemIndex)) {
        openModal(eventData.images, itemIndex);
      }
      return;
    }
  });

  dom.timeline.addEventListener("toggle", (event) => {
    if (!event.target.matches("details.media-details")) {
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
  }, true);

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
  const date = deriveDate(raw);
  const images = [
    ...parseAttachmentField(raw.Images, "image"),
    ...parseAttachmentField(raw["Document Images"], "image")
  ];
  const pdfs = parseAttachmentField(raw.PDFs, "pdf");
  const tags = parseList(raw.Tags);
  const people = parseList(raw["Related People & Groups"]);
  const location = raw.Location || "";
  const description = raw.Description || "";
  const sourceUrls = parseUrls(raw.Sources);
  const links = [
    ...sourceUrls.map((url, linkIndex) => ({ label: `Source ${linkIndex + 1}`, url })),
    ...toLabeledLink(raw["Google Search"], "Google Search"),
    ...toLabeledLink(raw["Image Search"], "Image Search")
  ];
  const type = raw.Type || "Uncategorized";
  const year = raw["Event Year"] || (date ? String(date.getUTCFullYear()) : "");
  const searchableText = [
    raw["Event Name"],
    description,
    location,
    type,
    year,
    raw.Tags,
    raw["Related People & Groups"],
    raw["Related Documents"]
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
    type,
    year,
    timeLabel: raw["Event Date & Time"] || raw["Event Timing"] || raw["Beginning Date"] || "Unknown date",
    date,
    sortTime: date ? date.getTime() : Number.POSITIVE_INFINITY,
    links,
    images,
    pdfs,
    relatedDocs: parseList(raw["Related Documents"]),
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
  const fallback = hintedType === "pdf" ? "pdf" : hintedType === "image" ? "image" : "file";
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

function toLabeledLink(rawUrl, label) {
  const first = parseUrls(rawUrl)[0];
  if (!first) {
    return [];
  }
  return [{ label, url: first }];
}

function deriveDate(record) {
  const candidates = [
    record["Event Date & Time"],
    record["Event Timing"],
    joinDateAndTime(record["Beginning Date"], record["Time (AM/PM)"] || record.Time),
    record["Beginning Date"]
  ];

  for (const candidate of candidates) {
    const parsed = parseFlexibleDate(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function joinDateAndTime(dateText, timeText) {
  const date = (dateText || "").trim();
  const time = (timeText || "").trim();
  if (!date) {
    return "";
  }
  return time ? `${date} ${time}` : date;
}

function parseFlexibleDate(value) {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }

  const native = Date.parse(text);
  if (!Number.isNaN(native)) {
    return new Date(native);
  }

  const dateTimeMatch = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?)?$/i
  );

  if (!dateTimeMatch) {
    return null;
  }

  let [, month, day, year, hour, minute, meridiem] = dateTimeMatch;
  let normalizedHour = hour ? Number.parseInt(hour, 10) : 0;
  const normalizedMinute = minute ? Number.parseInt(minute, 10) : 0;
  const normalizedMeridiem = (meridiem || "").toLowerCase();

  if (normalizedMeridiem === "pm" && normalizedHour < 12) {
    normalizedHour += 12;
  } else if (normalizedMeridiem === "am" && normalizedHour === 12) {
    normalizedHour = 0;
  }

  return new Date(
    Date.UTC(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10),
      normalizedHour,
      normalizedMinute
    )
  );
}

function sortEvents(left, right) {
  if (left.sortTime !== right.sortTime) {
    return left.sortTime - right.sortTime;
  }
  return left.eventName.localeCompare(right.eventName);
}

function populateFilters() {
  const types = [...new Set(state.events.map((event) => event.type).filter(Boolean))].sort();
  const years = [...new Set(state.events.map((event) => event.year).filter(Boolean))].sort((a, b) => Number(a) - Number(b));

  types.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    dom.typeFilter.append(option);
  });

  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    dom.yearFilter.append(option);
  });
}

function applyFilters() {
  const { search, type, year, mediaOnly } = state.filters;
  state.filteredEvents = state.events.filter((event) => {
    if (type && event.type !== type) {
      return false;
    }
    if (year && event.year !== year) {
      return false;
    }
    if (mediaOnly && event.images.length + event.pdfs.length === 0) {
      return false;
    }
    if (search && !event.searchableText.includes(search)) {
      return false;
    }
    return true;
  });

  renderTimeline();
  updateStats();
}

function updateStats() {
  const eventCount = state.filteredEvents.length;
  const imageCount = state.filteredEvents.reduce((sum, event) => sum + event.images.length, 0);
  const pdfCount = state.filteredEvents.reduce((sum, event) => sum + event.pdfs.length, 0);

  dom.visibleEvents.textContent = String(eventCount);
  dom.visibleImages.textContent = String(imageCount);
  dom.visiblePdfs.textContent = String(pdfCount);
}

function renderTimeline() {
  dom.timeline.replaceChildren();

  if (state.filteredEvents.length === 0) {
    dom.timeline.append(dom.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredEvents.forEach((event, groupIndex) => {
    fragment.append(buildEventRow(event, groupIndex));
  });
  dom.timeline.append(fragment);
}

function buildEventRow(event, groupIndex) {
  const row = document.createElement("li");
  row.className = "timeline-item";

  const card = document.createElement("article");
  card.className = "event-card";

  card.append(buildHeader(event));

  if (event.location || event.people.length) {
    const meta = document.createElement("p");
    meta.className = "event-meta";
    const peopleLabel = event.people.length ? `People: ${event.people.slice(0, 4).join(", ")}` : "";
    meta.textContent = [event.location ? `Location: ${event.location}` : "", peopleLabel]
      .filter(Boolean)
      .join(" | ");
    card.append(meta);
  }

  if (event.description) {
    const description = document.createElement("p");
    description.className = "event-description";
    description.textContent = event.description;
    card.append(description);
  }

  if (event.tags.length || event.type) {
    const chips = document.createElement("div");
    chips.className = "chip-row";
    chips.append(buildChip(event.type));
    event.tags.slice(0, 8).forEach((tag) => chips.append(buildChip(tag)));
    card.append(chips);
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
    card.append(links);
  }

  if (event.images.length) {
    card.append(buildMediaDetails(event.images, groupIndex));
  }

  if (event.pdfs.length || event.relatedDocs.length) {
    card.append(buildDocsDetails(event.pdfs, event.relatedDocs));
  }

  row.append(card);
  return row;
}

function buildHeader(event) {
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.className = "event-title";
  title.textContent = event.eventName;
  const date = document.createElement("time");
  date.className = "event-date";
  date.textContent = formatDate(event);
  header.append(title, date);
  return header;
}

function buildChip(text) {
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = text;
  return chip;
}

function buildMediaDetails(images, groupIndex) {
  const details = document.createElement("details");
  details.className = "media-details";

  const summary = document.createElement("summary");
  summary.textContent = `Images (${images.length})`;
  details.append(summary);

  const grid = document.createElement("div");
  grid.className = "media-grid";

  images.forEach((image, itemIndex) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button";
    button.dataset.mediaGroupIndex = String(groupIndex);
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

  details.append(grid);
  return details;
}

function buildDocsDetails(pdfs, relatedDocs) {
  const details = document.createElement("details");
  details.className = "docs-details";
  const totalCount = pdfs.length + relatedDocs.length;

  const summary = document.createElement("summary");
  summary.textContent = `Documents (${totalCount})`;
  details.append(summary);

  const list = document.createElement("ul");
  list.className = "doc-list";

  pdfs.forEach((pdf) => {
    const item = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.className = "doc-link";
    anchor.href = pdf.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.download = "";

    const label = document.createElement("span");
    label.textContent = pdf.label;
    const action = document.createElement("span");
    action.className = "doc-action";
    action.textContent = "Open / Download";

    anchor.append(label, action);
    item.append(anchor);
    list.append(item);
  });

  relatedDocs.slice(0, 20).forEach((docName) => {
    const item = document.createElement("li");
    item.textContent = docName;
    list.append(item);
  });

  details.append(list);
  return details;
}

function formatDate(event) {
  if (event.date) {
    const text = event.date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC"
    });
    return `${text} UTC`;
  }
  return event.timeLabel;
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
