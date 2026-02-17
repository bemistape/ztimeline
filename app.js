const DATA_URL = "data/events-timeline.csv";
const PEOPLE_DATA_URL = "data/people-people-sync.csv";
const LOCATION_DATA_URL = "data/location-location-sync.csv";
const TAG_DATA_URL = "data/tags-tags-sync.csv";
const ELEMENTS_DATA_URL = "data/elements-elements-sync.csv";
const ELEMENTS_FALLBACK_DATA_URL = "data/elements-starter.csv";
const EVENTS_METADATA_URL = "data/refresh-metadata.json";
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif"]);
const BLOCKED_MEDIA_EXTENSIONS = new Set(["tif", "tiff"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const UNKNOWN_TIME_MINUTES = 24 * 60 + 1;
const VALID_RECORD_KINDS = new Set(["person", "location", "tag"]);

const dom = {
  hero: document.querySelector(".hero"),
  controls: document.querySelector(".controls"),
  stickyNavShell: document.getElementById("sticky-nav-shell"),
  stickySiteTitle: document.getElementById("sticky-site-title"),
  stickyNav: document.getElementById("sticky-site-nav"),
  heroEyebrow: document.getElementById("hero-eyebrow"),
  heroTitle: document.getElementById("hero-title"),
  heroCopy: document.getElementById("hero-copy"),
  siteNav: document.getElementById("site-nav"),
  siteFooter: document.getElementById("site-footer"),
  footerAbout: document.getElementById("footer-about"),
  footerLinks: document.getElementById("footer-links"),
  footerLegal: document.getElementById("footer-legal"),
  searchInput: document.getElementById("search-input"),
  locationFilter: document.getElementById("location-filter"),
  peopleFilter: document.getElementById("people-filter"),
  tagFilter: document.getElementById("tag-filter"),
  mediaOnlyFilter: document.getElementById("media-only-filter"),
  resetFilters: document.getElementById("reset-filters"),
  dataFreshness: document.getElementById("data-freshness"),
  timelineSection: document.querySelector(".timeline-section"),
  timeline: document.getElementById("timeline"),
  imageModal: document.getElementById("image-modal"),
  modalFigure: document.getElementById("modal-figure"),
  modalImage: document.getElementById("modal-image"),
  modalCaption: document.getElementById("modal-caption"),
  modalClose: document.getElementById("modal-close"),
  modalPrev: document.getElementById("modal-prev"),
  modalNext: document.getElementById("modal-next"),
  modalZoomIn: document.getElementById("modal-zoom-in"),
  modalZoomOut: document.getElementById("modal-zoom-out"),
  modalResetView: document.getElementById("modal-reset-view"),
  modalRotate: document.getElementById("modal-rotate"),
  modalFullscreen: document.getElementById("modal-fullscreen"),
  modalOpenOriginal: document.getElementById("modal-open-original"),
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
  elements: [],
  filteredEvents: [],
  filters: {
    search: "",
    locations: [],
    people: [],
    tags: [],
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
  eventNameById: new Map(),
  modalMedia: [],
  modalIndex: 0,
  modalView: {
    zoom: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0
  },
  route: {
    eventName: "",
    recordKind: "",
    recordName: ""
  },
  suppressUrlSync: false,
  recordModalImages: [],
  recordModalRelatedEvents: []
};

init().catch((error) => {
  console.error(error);
  renderLoadError(error);
});

async function init() {
  bindUi();
  const { eventsCsv, peopleCsv, locationCsv, tagCsv, elementsCsv, elementsFallbackCsv, eventsMetadata } = await loadDataSources();

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
  state.elements = parseElementsRows(elementsCsv || elementsFallbackCsv);
  applyElementsContent(state.elements);

  populateFilters();
  state.suppressUrlSync = true;
  restoreStateFromUrl();
  applyFilters();
  applyRouteFromUrl();
  state.suppressUrlSync = false;
  syncUrlState();
  renderDataFreshness(eventsMetadata);
}

async function loadDataSources() {
  const [eventsCsv, peopleCsv, locationCsv, tagCsv, elementsCsv, elementsFallbackCsv, eventsMetadata] = await Promise.all([
    fetchOptionalCsv(DATA_URL),
    fetchOptionalCsv(PEOPLE_DATA_URL),
    fetchOptionalCsv(LOCATION_DATA_URL),
    fetchOptionalCsv(TAG_DATA_URL),
    fetchOptionalCsv(ELEMENTS_DATA_URL),
    fetchOptionalCsv(ELEMENTS_FALLBACK_DATA_URL),
    fetchOptionalJson(EVENTS_METADATA_URL)
  ]);

  const bundled = readBundledData();
  const resolved = {
    eventsCsv: eventsCsv || bundled?.eventsCsv || "",
    peopleCsv: peopleCsv || bundled?.peopleCsv || "",
    locationCsv: locationCsv || bundled?.locationCsv || "",
    tagCsv: tagCsv || bundled?.tagCsv || "",
    elementsCsv: elementsCsv || bundled?.elementsCsv || "",
    elementsFallbackCsv: elementsFallbackCsv || bundled?.elementsFallbackCsv || "",
    eventsMetadata: eventsMetadata || bundled?.eventsMetadata || null
  };
  if (!resolved.eventsCsv.trim()) {
    throw new Error(`Unable to fetch ${DATA_URL}`);
  }

  return resolved;
}

function readBundledData() {
  const payload = window.__ZTIMELINE_DATA__;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const eventsCsv = typeof payload.eventsCsv === "string" ? payload.eventsCsv : "";
  if (!eventsCsv.trim()) {
    return null;
  }
  return {
    eventsCsv,
    peopleCsv: typeof payload.peopleCsv === "string" ? payload.peopleCsv : "",
    locationCsv: typeof payload.locationCsv === "string" ? payload.locationCsv : "",
    tagCsv: typeof payload.tagCsv === "string" ? payload.tagCsv : "",
    elementsCsv: typeof payload.elementsCsv === "string" ? payload.elementsCsv : "",
    elementsFallbackCsv: typeof payload.elementsFallbackCsv === "string" ? payload.elementsFallbackCsv : "",
    eventsMetadata: payload.eventsMetadata && typeof payload.eventsMetadata === "object" ? payload.eventsMetadata : null
  };
}

function bindUi() {
  bindMultiSelectToggle(dom.locationFilter);
  bindMultiSelectToggle(dom.peopleFilter);
  bindMultiSelectToggle(dom.tagFilter);

  dom.searchInput.addEventListener("input", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.search = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  dom.locationFilter.addEventListener("change", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.locations = getSelectedSelectValues(event.target);
    applyFilters();
  });

  dom.peopleFilter.addEventListener("change", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.people = getSelectedSelectValues(event.target);
    applyFilters();
  });

  if (dom.tagFilter) {
    dom.tagFilter.addEventListener("change", (event) => {
      state.filters.relatedEventSet = null;
      state.filters.tags = getSelectedSelectValues(event.target);
      applyFilters();
    });
  }

  dom.mediaOnlyFilter.addEventListener("change", (event) => {
    state.filters.relatedEventSet = null;
    state.filters.mediaOnly = event.target.checked;
    applyFilters();
  });

  dom.resetFilters.addEventListener("click", () => {
    state.filters.search = "";
    state.filters.locations = [];
    state.filters.people = [];
    state.filters.tags = [];
    state.filters.mediaOnly = false;
    state.filters.relatedEventSet = null;
    state.route.eventName = "";
    state.route.recordKind = "";
    state.route.recordName = "";

    dom.searchInput.value = "";
    clearSelectSelection(dom.locationFilter);
    clearSelectSelection(dom.peopleFilter);
    if (dom.tagFilter) {
      clearSelectSelection(dom.tagFilter);
    }
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
      const details = event.target;
      if (!details.matches("details.event-item")) {
        return;
      }
      if (details.open) {
        if (details.dataset.loaded !== "1") {
          const lazyImages = details.querySelectorAll("img[data-src]");
          lazyImages.forEach((image) => {
            image.src = image.dataset.src;
            image.removeAttribute("data-src");
          });
          details.dataset.loaded = "1";
        }
        state.route.eventName = findEventNameByKey(details.dataset.eventNameKey);
      } else if (normalizeKey(state.route.eventName) === details.dataset.eventNameKey) {
        state.route.eventName = "";
      }
      syncUrlState();
    },
    true
  );

  dom.modalClose.addEventListener("click", () => closeModal());
  dom.modalPrev.addEventListener("click", () => shiftModal(-1));
  dom.modalNext.addEventListener("click", () => shiftModal(1));
  dom.modalZoomIn.addEventListener("click", () => changeModalZoom(0.2));
  dom.modalZoomOut.addEventListener("click", () => changeModalZoom(-0.2));
  dom.modalResetView.addEventListener("click", () => resetModalImageView());
  dom.modalRotate.addEventListener("click", () => rotateModalImage(90));
  dom.modalFullscreen.addEventListener("click", () => toggleModalFullscreen());
  dom.recordModalClose.addEventListener("click", () => closeRecordModal());
  dom.modalFigure.addEventListener(
    "wheel",
    (event) => {
      if (!dom.imageModal.open) {
        return;
      }
      event.preventDefault();
      changeModalZoom(event.deltaY < 0 ? 0.12 : -0.12);
    },
    { passive: false }
  );
  dom.modalImage.addEventListener("pointerdown", (event) => beginModalImageDrag(event));
  dom.modalImage.addEventListener("pointermove", (event) => dragModalImage(event));
  dom.modalImage.addEventListener("pointerup", (event) => endModalImageDrag(event));
  dom.modalImage.addEventListener("pointercancel", (event) => endModalImageDrag(event));
  document.addEventListener("fullscreenchange", () => updateModalFullscreenLabel());

  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("img")) {
      event.preventDefault();
    }
  });

  document.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("img")) {
      event.preventDefault();
    }
  });

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
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeModalZoom(0.2);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeModalZoom(-0.2);
    } else if (event.key === "0") {
      event.preventDefault();
      resetModalImageView();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      rotateModalImage(90);
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleModalFullscreen();
    }
  });

  window.addEventListener("popstate", () => {
    state.suppressUrlSync = true;
    restoreStateFromUrl();
    applyFilters();
    applyRouteFromUrl();
    state.suppressUrlSync = false;
  });

  bindStickyNavVisibility();
}

async function fetchCsv(url) {
  const response = await fetchWithAssetFallback(url, "csv");
  if (!response) {
    throw new Error(`Unable to fetch ${url}`);
  }
  return response.text();
}

async function fetchOptionalCsv(url) {
  const response = await fetchWithAssetFallback(url, "csv");
  if (!response) {
    return "";
  }
  return response.text();
}

async function fetchOptionalJson(url) {
  const response = await fetchWithAssetFallback(url, "json");
  if (!response) {
    return null;
  }
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function fetchWithAssetFallback(url, kind = "text") {
  const candidates = buildAssetUrlCandidates(url);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      if (await isLikelyHtmlFallback(response, kind)) {
        continue;
      }
      return response;
    } catch (error) {
      // Ignore and try the next candidate.
    }
  }
  return null;
}

function buildAssetUrlCandidates(url) {
  const source = sanitizeText(url);
  if (!source) {
    return [];
  }
  if (/^(?:https?:)?\/\//i.test(source) || /^(?:mailto:|tel:)/i.test(source)) {
    return [source];
  }

  const cleanPath = source.replace(/^\.\//, "").replace(/^\/+/, "");
  const candidates = new Set();
  const addCandidate = (value) => {
    if (value) {
      candidates.add(value);
    }
  };

  const scriptBase = getAppScriptBaseUrl();
  if (scriptBase) {
    addCandidate(new URL(cleanPath, scriptBase).toString());
  }

  const currentDirectoryBase = new URL("./", window.location.href);
  addCandidate(new URL(cleanPath, currentDirectoryBase).toString());

  addCandidate(new URL(`/${cleanPath}`, window.location.origin).toString());

  const repoBase = getLikelyRepoBasePath();
  if (repoBase) {
    addCandidate(new URL(`${repoBase}/${cleanPath}`, window.location.origin).toString());
  }

  if (cleanPath.startsWith("data/")) {
    const rootlessPath = cleanPath.slice("data/".length);
    if (rootlessPath) {
      if (scriptBase) {
        addCandidate(new URL(rootlessPath, scriptBase).toString());
      }
      addCandidate(new URL(rootlessPath, currentDirectoryBase).toString());
      addCandidate(new URL(`/${rootlessPath}`, window.location.origin).toString());
      if (repoBase) {
        addCandidate(new URL(`${repoBase}/${rootlessPath}`, window.location.origin).toString());
      }
    }
  }

  return [...candidates];
}

function getAppScriptBaseUrl() {
  const script = [...document.scripts].find((element) => /(?:^|\/)app\.js(?:[?#].*)?$/.test(element.src || ""));
  if (!script?.src) {
    return "";
  }
  try {
    return new URL("./", script.src).toString();
  } catch (error) {
    return "";
  }
}

function getLikelyRepoBasePath() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "";
  }
  return `/${segments[0]}`;
}

async function isLikelyHtmlFallback(response, kind) {
  if (kind !== "csv" && kind !== "json") {
    return false;
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const maybeHtml =
    !contentType || contentType.includes("text/html") || contentType.includes("application/xhtml") || contentType.includes("text/plain");
  if (!maybeHtml) {
    return false;
  }
  try {
    const prefix = (await response.clone().text()).slice(0, 256).trimStart().toLowerCase();
    return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
  } catch (error) {
    return false;
  }
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

function parseElementsRows(csvText) {
  const text = String(csvText || "").trim();
  if (!text) {
    return [];
  }
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return [];
  }
  return rowsToObjects(rows)
    .map(normalizeElementRecord)
    .filter((element) => element.key && element.published);
}

function normalizeElementRecord(raw) {
  const parsedOrder = Number.parseInt(sanitizeText(pickRawFieldValue(raw, ["Sort Order", "Sort", "Order", "Position"])), 10);
  const type = sanitizeText(pickRawFieldValue(raw, ["Element Type", "Type", "Kind"])).toLowerCase() || "text";
  const label = sanitizeText(pickRawFieldValue(raw, ["Label", "Title", "Name"]));
  const linkLabel = sanitizeText(pickRawFieldValue(raw, ["Link Label", "Button Label", "Link Text"]));
  const resolvedKey = canonicalizeElementKey(
    sanitizeText(pickRawFieldValue(raw, ["Element Key", "Key", "Slot"])) ||
      inferElementKey({
        type,
        label,
        linkLabel
      })
  );
  return {
    key: resolvedKey,
    type,
    label,
    body: sanitizeText(pickRawFieldValue(raw, ["Body", "Text", "Content", "Value", "Copy", "Description"])),
    linkLabel,
    linkUrl: sanitizeLinkUrl(pickRawFieldValue(raw, ["Link URL", "URL", "Link"])),
    sortOrder: Number.isFinite(parsedOrder) ? parsedOrder : Number.MAX_SAFE_INTEGER,
    published: parseBooleanFlag(pickRawFieldValue(raw, ["Published", "Enabled", "Active", "Show"]), true),
    locale: sanitizeText(pickRawFieldValue(raw, ["Locale", "Language"])).toLowerCase(),
    notes: sanitizeText(pickRawFieldValue(raw, ["Notes", "Internal Notes"]))
  };
}

function parseBooleanFlag(value, defaultValue = false) {
  const normalized = sanitizeText(value).toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ["1", "true", "yes", "y", "on", "checked", "published", "enabled", "active"].includes(normalized);
}

function pickRawFieldValue(raw, candidates) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(raw, candidate)) {
      const value = raw[candidate];
      if (sanitizeText(value)) {
        return value;
      }
    }
  }
  const normalizedCandidates = new Set(candidates.map((candidate) => normalizeKey(candidate)));
  for (const [key, value] of Object.entries(raw)) {
    if (!normalizedCandidates.has(normalizeKey(key))) {
      continue;
    }
    if (sanitizeText(value)) {
      return value;
    }
  }
  return "";
}

function inferElementKey({ type, label, linkLabel }) {
  const fingerprint = normalizeKey(`${label} ${linkLabel}`);
  const navLike = normalizeKey(type).includes("nav");

  if (navLike || fingerprint === "home" || fingerprint.startsWith("nav ")) {
    if (fingerprint.includes("timeline")) {
      return "nav.timeline";
    }
    if (fingerprint.includes("source")) {
      return "nav.sources";
    }
    if (fingerprint.includes("about")) {
      return "nav.about";
    }
    return "nav.home";
  }

  if (
    fingerprint.includes("site title") ||
    fingerprint.includes("page title") ||
    fingerprint === "title" ||
    fingerprint === "site title"
  ) {
    return "site.title";
  }
  if (
    fingerprint.includes("subtitle") ||
    fingerprint.includes("sub title") ||
    fingerprint.includes("eyebrow") ||
    fingerprint.includes("kicker")
  ) {
    return "site.subtitle";
  }
  if (
    fingerprint.includes("intro") ||
    fingerprint.includes("subhead") ||
    fingerprint.includes("description") ||
    fingerprint.includes("hero copy")
  ) {
    return "site.intro";
  }
  if (fingerprint.includes("about")) {
    return "site.about_blurb";
  }
  if (fingerprint.includes("privacy")) {
    return "legal.privacy";
  }
  if (fingerprint.includes("terms")) {
    return "legal.terms";
  }
  if (fingerprint.includes("legal") || fingerprint.includes("disclaimer")) {
    return "legal.disclaimer";
  }

  const slug = fingerprint.replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  return slug ? `custom.${slug}` : "";
}

function canonicalizeElementKey(value) {
  const clean = normalizeKey(value).replace(/[^a-z0-9]+/g, ".").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "");
  if (!clean) {
    return "";
  }
  const aliases = new Map([
    ["title", "site.title"],
    ["site.title.text", "site.title"],
    ["page.title", "site.title"],
    ["hero.title", "site.title"],
    ["subtitle", "site.subtitle"],
    ["subhead", "site.intro"],
    ["description", "site.intro"],
    ["intro", "site.intro"],
    ["about", "site.about_blurb"],
    ["about.copy", "site.about_blurb"],
    ["home", "nav.home"],
    ["about.us", "site.about_blurb"]
  ]);
  return aliases.get(clean) || clean;
}

function applyElementsContent(elements) {
  if (!elements || elements.length === 0) {
    return;
  }
  const locale = sanitizeText(document.documentElement.lang || "en-US").toLowerCase();
  const localized = localizeElements(elements, locale);
  const byKey = new Map(localized.map((element) => [normalizeKey(element.key), element]));

  const siteTitle = getElementText(
    findFirstElement(byKey, ["site.title", "hero.title", "page.title", "home.title", "title"])
  );
  if (siteTitle && dom.heroTitle) {
    dom.heroTitle.textContent = siteTitle;
    document.title = siteTitle;
    if (dom.stickySiteTitle) {
      dom.stickySiteTitle.textContent = siteTitle;
    }
  }

  const subtitle = getElementText(
    findFirstElement(byKey, ["site.subtitle", "hero.subtitle", "site.eyebrow", "hero.eyebrow", "page.subtitle"])
  );
  if (subtitle && dom.heroEyebrow) {
    dom.heroEyebrow.textContent = subtitle;
  }

  const intro = getElementText(
    findFirstElement(byKey, ["site.intro", "hero.intro", "hero.copy", "site.subhead", "site.description"])
  );
  if (intro && dom.heroCopy) {
    dom.heroCopy.textContent = intro;
    const descriptionMeta = document.querySelector('meta[name="description"]');
    if (descriptionMeta) {
      descriptionMeta.setAttribute("content", intro);
    }
  }

  renderSiteNav(localized);
  renderSiteFooter(localized, byKey);
}

function localizeElements(elements, preferredLocale) {
  const sorted = [...elements].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.key.localeCompare(right.key);
  });
  const exactMatches = sorted.filter((element) => element.locale && element.locale === preferredLocale);
  const localeNeutral = sorted.filter((element) => !element.locale);
  const fallback = sorted.filter((element) => element.locale && element.locale !== preferredLocale);
  const byKey = new Map();
  [...exactMatches, ...localeNeutral, ...fallback].forEach((element) => {
    const key = normalizeKey(element.key);
    if (key && !byKey.has(key)) {
      byKey.set(key, element);
    }
  });
  return [...byKey.values()].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.key.localeCompare(right.key);
  });
}

function getElementText(element) {
  if (!element) {
    return "";
  }
  return sanitizeText(element.body) || sanitizeText(element.label);
}

function getElementLinkLabel(element) {
  return sanitizeText(element?.linkLabel) || sanitizeText(element?.label) || sanitizeText(element?.body) || "";
}

function renderSiteNav(elements) {
  if (!dom.siteNav && !dom.stickyNav) {
    return;
  }
  const navItems = elements
    .filter((element) => {
      const key = normalizeKey(element.key);
      const type = normalizeKey(element.type);
      const isNav = key.startsWith("nav.") || type === "nav_link" || type === "nav" || type.includes("nav");
      if (!isNav || !element.linkUrl) {
        return false;
      }
      return !isSuppressedNavItem(element, key);
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  renderNavContainer(dom.siteNav, navItems);
  renderNavContainer(dom.stickyNav, navItems);
  updateStickyNavVisibility();
}

function renderNavContainer(container, navItems) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  navItems.forEach((item) => {
    const label = getElementLinkLabel(item);
    if (!label) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.className = "site-nav-link";
    anchor.textContent = label;
    const action = getNavAction(item);
    if (action) {
      anchor.href = "#";
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        runNavAction(action);
      });
    } else {
      anchor.href = item.linkUrl;
    }
    if (!action && isExternalUrl(item.linkUrl)) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    container.append(anchor);
  });
  container.hidden = container.childElementCount === 0;
}

function bindStickyNavVisibility() {
  if (!dom.stickyNavShell) {
    return;
  }
  let ticking = false;
  const onViewportChange = () => {
    if (ticking) {
      return;
    }
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      updateStickyNavVisibility();
    });
  };
  window.addEventListener("scroll", onViewportChange, { passive: true });
  window.addEventListener("resize", onViewportChange);
  updateStickyNavVisibility();
}

function updateStickyNavVisibility() {
  if (!dom.stickyNavShell || !dom.stickyNav) {
    return;
  }
  const hasNavItems = dom.stickyNav.childElementCount > 0;
  if (!hasNavItems) {
    dom.stickyNavShell.classList.remove("is-visible");
    return;
  }

  const anchor = dom.controls || dom.hero;
  if (!anchor) {
    dom.stickyNavShell.classList.toggle("is-visible", window.scrollY > 180);
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const shouldShow = rect.top < -24;
  dom.stickyNavShell.classList.toggle("is-visible", shouldShow);
}

function isSuppressedNavItem(element, key) {
  if (key === "nav.timeline" || key === "nav.sources") {
    return true;
  }
  const labelFingerprint = normalizeKey(`${sanitizeText(element.label)} ${getElementLinkLabel(element)}`);
  return /\btimeline\b/.test(labelFingerprint) || /\bsources?\b/.test(labelFingerprint);
}

function getNavAction(item) {
  const key = normalizeKey(item?.key);
  const label = normalizeKey(getElementLinkLabel(item));
  if (key === "nav.home" || label === "home") {
    return "home";
  }
  if (key === "nav.timeline" || label === "timeline") {
    return "timeline";
  }
  if (key === "nav.sources" || label === "sources") {
    return "sources";
  }
  if (key === "nav.about" || label === "about") {
    return "about";
  }
  return "";
}

function runNavAction(action) {
  if (action === "home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (action === "timeline") {
    (dom.timelineSection || dom.timeline)?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "sources") {
    state.filters.mediaOnly = true;
    state.filters.relatedEventSet = null;
    dom.mediaOnlyFilter.checked = true;
    applyFilters();
    (dom.timelineSection || dom.timeline)?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "about") {
    (dom.siteFooter || dom.timeline)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function renderSiteFooter(elements, byKey) {
  if (!dom.siteFooter || !dom.footerAbout || !dom.footerLinks || !dom.footerLegal) {
    return;
  }
  dom.footerAbout.replaceChildren();
  dom.footerLinks.replaceChildren();
  dom.footerLegal.replaceChildren();

  const aboutElement = findFirstElement(byKey, ["site.about_blurb", "footer.about", "about.copy", "about.us"]);
  const aboutText = getElementText(aboutElement);
  if (aboutText) {
    dom.footerAbout.append(renderRichTextBlock(aboutText, "footer-about-copy"));
    dom.footerAbout.hidden = false;
  } else {
    dom.footerAbout.hidden = true;
  }

  const linkItems = elements
    .filter((element) => {
      const key = normalizeKey(element.key);
      if (key.startsWith("nav.")) {
        return false;
      }
      return Boolean(element.linkUrl) && (key.startsWith("footer.") || key.startsWith("legal.") || key.startsWith("cta."));
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
  linkItems.forEach((item) => {
    const label = getElementLinkLabel(item);
    if (!label) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.className = "footer-link";
    anchor.href = item.linkUrl;
    anchor.textContent = label;
    if (isExternalUrl(item.linkUrl)) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    dom.footerLinks.append(anchor);
  });
  dom.footerLinks.hidden = dom.footerLinks.childElementCount === 0;

  const legalTextItems = elements
    .filter((element) => normalizeKey(element.key).startsWith("legal.") && !element.linkUrl)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  legalTextItems.forEach((item) => {
    const text = getElementText(item);
    if (!text) {
      return;
    }
    const block = renderRichTextBlock(text, "footer-legal-copy");
    dom.footerLegal.append(block);
  });
  dom.footerLegal.hidden = dom.footerLegal.childElementCount === 0;

  dom.siteFooter.hidden = dom.footerAbout.hidden && dom.footerLinks.hidden && dom.footerLegal.hidden;
}

function findFirstElement(byKey, keys) {
  for (const key of keys) {
    const element = byKey.get(normalizeKey(key));
    if (element) {
      return element;
    }
  }
  return null;
}

function isExternalUrl(url) {
  const text = sanitizeText(url);
  if (!text) {
    return false;
  }
  if (/^(mailto:|tel:)/i.test(text) || text.startsWith("/") || text.startsWith("#") || text.startsWith("?")) {
    return false;
  }
  try {
    const parsed = new URL(text, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return parsed.origin !== window.location.origin;
  } catch (error) {
    return false;
  }
}

function rowsToObjects(rows) {
  const headers = rows[0].map((header) => header.replace(/^\ufeff/, "").trim());
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
  const { timeMinutes, timeLabel } = resolveEventTime(raw);
  const recordId = firstField(raw, ["_Airtable Record ID", "Event Record ID", "ID"]);

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
    recordId,
    eventName: raw["Event Name"] || "Untitled event",
    description,
    type,
    location,
    locationFallback,
    people,
    peopleFallback,
    tags,
    dateKey,
    dateLabel,
    timeLabel,
    sortTime: beginningDate ? beginningDate.getTime() + timeMinutes * 60_000 : Number.POSITIVE_INFINITY,
    hasMap: false,
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
  const type = inferAttachmentType(label, url, hintedType);
  if (type === "blocked") {
    return;
  }
  seen.add(url);
  target.push({
    label,
    url,
    type
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
  if (BLOCKED_MEDIA_EXTENSIONS.has(extension)) {
    return "blocked";
  }
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

function isMeaningfulToken(value) {
  return /[\p{L}\p{N}]/u.test(sanitizeText(value));
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

function resolveEventTime(raw) {
  const candidates = [
    { value: raw["Time (AM/PM)"], explicitOnly: false },
    { value: raw.Time, explicitOnly: false },
    { value: raw["Event Timing"], explicitOnly: true }
  ];
  for (const candidate of candidates) {
    const text = sanitizeText(candidate.value);
    if (!text) {
      continue;
    }
    if (text === "0" || text === "00:00:00" || text === "00:00") {
      continue;
    }
    if (candidate.explicitOnly && !/(?:\d{1,2}:\d{2}|[ap]\.?m\.?)/i.test(text)) {
      continue;
    }
    const numericMinutes = parseNumericTimeToMinutes(text);
    if (numericMinutes !== UNKNOWN_TIME_MINUTES) {
      return {
        timeMinutes: numericMinutes,
        timeLabel: formatTimeLabel(numericMinutes)
      };
    }
    const parsedMinutes = parseTimeToMinutes(text);
    if (parsedMinutes !== UNKNOWN_TIME_MINUTES) {
      return {
        timeMinutes: parsedMinutes,
        timeLabel: formatTimeLabel(parsedMinutes)
      };
    }
  }
  return {
    timeMinutes: UNKNOWN_TIME_MINUTES,
    timeLabel: ""
  };
}

function parseTimeToMinutes(value) {
  const text = sanitizeText(value).toLowerCase();
  if (!text) {
    return UNKNOWN_TIME_MINUTES;
  }

  let match = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (match) {
    let hours = Number.parseInt(match[1] || "", 10);
    const minutes = Number.parseInt(match[2] || "0", 10);
    const meridiem = String(match[3] || "").toLowerCase();
    if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
      if (meridiem === "p" && hours < 12) {
        hours += 12;
      } else if (meridiem === "a" && hours === 12) {
        hours = 0;
      }
      return hours * 60 + minutes;
    }
  }

  match = text.match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/);
  if (match) {
    const hours = Number.parseInt(match[1] || "", 10);
    const minutes = Number.parseInt(match[2] || "", 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  return UNKNOWN_TIME_MINUTES;
}

function parseNumericTimeToMinutes(value) {
  const text = sanitizeText(value);
  if (!/^\d{1,8}$/.test(text)) {
    return UNKNOWN_TIME_MINUTES;
  }
  if (text === "0") {
    return UNKNOWN_TIME_MINUTES;
  }
  const numeric = Number.parseInt(text, 10);
  if (!Number.isFinite(numeric)) {
    return UNKNOWN_TIME_MINUTES;
  }

  if (/^\d{3,4}$/.test(text)) {
    const hours = Math.floor(numeric / 100);
    const minutes = numeric % 100;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  if (numeric >= 0 && numeric <= 1439) {
    return numeric;
  }
  if (numeric >= 0 && numeric <= 86399) {
    return Math.floor(numeric / 60);
  }
  if (numeric >= 0 && numeric <= 86399999 && numeric % 1000 === 0) {
    return Math.floor(numeric / 60000);
  }

  return UNKNOWN_TIME_MINUTES;
}

function formatTimeLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes === UNKNOWN_TIME_MINUTES) {
    return "";
  }

  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, Math.trunc(minutes)));
  const hours24 = Math.floor(safeMinutes / 60);
  const minutePart = safeMinutes % 60;
  const meridiem = hours24 >= 12 ? "PM" : "AM";
  let hours12 = hours24 % 12;
  if (hours12 === 0) {
    hours12 = 12;
  }
  return `${hours12}:${String(minutePart).padStart(2, "0")} ${meridiem}`;
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
  return `${weekday}, ${main}`;
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
  const tagCounts = new Map();

  state.events.forEach((event) => {
    if (event.location) {
      locationCounts.set(event.location, (locationCounts.get(event.location) || 0) + 1);
    }
    event.people.forEach((person) => {
      peopleCounts.set(person, (peopleCounts.get(person) || 0) + 1);
    });
    event.tags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  fillSelectOptions(dom.locationFilter, locationCounts, state.filters.locations);
  fillSelectOptions(dom.peopleFilter, peopleCounts, state.filters.people);
  if (dom.tagFilter) {
    fillSelectOptions(dom.tagFilter, tagCounts, state.filters.tags);
  }

  state.filters.locations = getSelectedSelectValues(dom.locationFilter);
  state.filters.people = getSelectedSelectValues(dom.peopleFilter);
  state.filters.tags = dom.tagFilter ? getSelectedSelectValues(dom.tagFilter) : [];
}

function fillSelectOptions(select, countsMap, selectedValues = []) {
  select.replaceChildren();

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

  setSelectedSelectValues(select, selectedValues);
}

function applyFilters() {
  const { search, locations, people, tags, mediaOnly, relatedEventSet } = state.filters;
  const selectedLocationKeys = new Set((locations || []).map((value) => normalizeKey(value)));
  const selectedPeopleKeys = new Set((people || []).map((value) => normalizeKey(value)));
  const selectedTagKeys = new Set((tags || []).map((value) => normalizeKey(value)));

  state.filteredEvents = state.events.filter((event) => {
    if (selectedLocationKeys.size > 0 && !selectedLocationKeys.has(normalizeKey(event.location))) {
      return false;
    }
    if (selectedPeopleKeys.size > 0 && !event.people.some((person) => selectedPeopleKeys.has(normalizeKey(person)))) {
      return false;
    }
    if (selectedTagKeys.size > 0 && !event.tags.some((tag) => selectedTagKeys.has(normalizeKey(tag)))) {
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
  if (state.route.eventName && !state.suppressUrlSync) {
    const key = normalizeKey(state.route.eventName);
    const isOpen = [...dom.timeline.querySelectorAll("details.event-item[open]")].some(
      (item) => item.dataset.eventNameKey === key
    );
    if (!isOpen) {
      state.route.eventName = "";
    }
  }
  syncUrlState();
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

  const rail = document.createElement("div");
  rail.className = "date-rail";

  const heading = document.createElement("h2");
  heading.className = "date-heading";

  const label = document.createElement("span");
  label.className = "date-label";
  label.textContent = group.label;

  heading.append(label);
  rail.append(heading);

  const list = document.createElement("ol");
  list.className = "group-events";

  group.items.forEach(({ event, filteredIndex }) => {
    list.append(buildEventRow(event, filteredIndex));
  });

  row.append(rail, list);
  return row;
}

function buildEventRow(event, filteredIndex) {
  const row = document.createElement("li");
  row.className = "timeline-item";

  const details = document.createElement("details");
  details.className = "event-item";
  details.dataset.eventName = event.eventName;
  details.dataset.eventNameKey = normalizeKey(event.eventName);
  const tint = getTypeTint(event.type);
  details.style.setProperty("--record-tint-bg", tint.background);
  details.style.setProperty("--record-tint-border", tint.border);
  details.style.setProperty("--type-badge-bg", tint.badgeBackground);
  details.style.setProperty("--type-badge-border", tint.badgeBorder);
  details.style.setProperty("--type-badge-ink", tint.badgeInk);

  const summary = document.createElement("summary");
  summary.className = "event-summary";

  const summaryText = document.createElement("div");
  summaryText.className = "summary-text";

  const title = document.createElement("h3");
  title.className = "event-title";
  title.textContent = resolveDisplayToken(event.eventName) || "Untitled event";

  const titleActions = document.createElement("div");
  titleActions.className = "event-title-actions";

  const expander = document.createElement("span");
  expander.className = "event-expander";
  expander.setAttribute("aria-hidden", "true");

  titleActions.append(expander);

  const titleRow = document.createElement("div");
  titleRow.className = "event-title-row";
  titleRow.append(title, titleActions);

  const fieldGrid = document.createElement("div");
  fieldGrid.className = "summary-fields";
  const summaryFields = [buildSummaryLocationField(event.location), buildSummaryPeopleField(event.people)];
  fieldGrid.append(...summaryFields);

  summaryText.append(titleRow, fieldGrid);

  const summaryTop = document.createElement("div");
  summaryTop.className = "summary-top";
  const summaryMeta = document.createElement("div");
  summaryMeta.className = "summary-meta";
  const typeBadge = document.createElement("span");
  typeBadge.className = "event-type-badge";
  typeBadge.textContent = resolveDisplayToken(event.type) || "Uncategorized";
  summaryMeta.append(typeBadge);
  if (event.timeLabel) {
    const timeLabel = document.createElement("span");
    timeLabel.className = "summary-inline-time";
    timeLabel.textContent = event.timeLabel;
    summaryMeta.append(timeLabel);
  }
  summaryTop.append(summaryMeta, summaryText);

  if (event.images.length > 0) {
    const summaryThumbButton = document.createElement("button");
    summaryThumbButton.type = "button";
    summaryThumbButton.className = "summary-thumb-button";
    summaryThumbButton.dataset.mediaGroupIndex = String(filteredIndex);
    summaryThumbButton.dataset.mediaItemIndex = "0";
    summaryThumbButton.setAttribute(
      "aria-label",
      `Open primary image for ${resolveDisplayToken(event.eventName) || "this event"}`
    );

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

  const chip = buildRecordChip(location, "location", location, true);
  if (chip) {
    item.append(chip);
    return item;
  }
  const fallback = document.createElement("span");
  fallback.className = "summary-value";
  fallback.textContent = "-";
  item.append(fallback);
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
  let renderedPeopleCount = 0;
  visiblePeople.forEach((person) => {
    const chip = buildRecordChip(person, "person", person, true);
    if (chip) {
      wrap.append(chip);
      renderedPeopleCount += 1;
    }
  });

  if (people.length > renderedPeopleCount) {
    const overflow = document.createElement("span");
    overflow.className = "summary-overflow";
    overflow.textContent = `+${people.length - renderedPeopleCount} more`;
    wrap.append(overflow);
  }

  item.append(wrap);
  return item;
}

function buildRecordChip(label, kind, value, compact = false) {
  const cleanLabel = resolveDisplayToken(label, kind);
  const cleanValue = resolveDisplayToken(value, kind);
  if (!cleanLabel || !cleanValue) {
    return null;
  }

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `filter-chip ${kind}-chip`;
  if (compact) {
    chip.classList.add("summary-chip");
  }
  chip.textContent = cleanLabel;
  chip.dataset.recordKind = kind;
  chip.dataset.recordName = cleanValue;

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
    background: `hsl(${hue} 22% 14%)`,
    border: `hsl(${hue} 34% 42%)`,
    badgeBackground: `hsl(${hue} 58% 88%)`,
    badgeBorder: `hsl(${hue} 38% 52%)`,
    badgeInk: `hsl(${hue} 30% 20%)`
  };
}

function buildRelatedIndexes({ peopleCsv, locationCsv, tagCsv }) {
  const eventNameLookup = new Map();
  state.eventNameById = new Map();
  state.events.forEach((event) => {
    eventNameLookup.set(normalizeKey(event.eventName), event.eventName);
    if (event.recordId) {
      const idKey = normalizeKey(event.recordId);
      eventNameLookup.set(idKey, event.eventName);
      state.eventNameById.set(idKey, event.eventName);
    }
  });

  state.related.person = buildPersonIndex(peopleCsv, eventNameLookup);
  state.related.location = buildLocationIndex(locationCsv, eventNameLookup);
  state.related.tag = buildTagIndex(tagCsv, eventNameLookup);

  state.relatedById.person = buildIdLookup(
    peopleCsv,
    ["People Record ID", "Person Record ID", "Record ID", "ID", "_Airtable Record ID"],
    ["Full Name", "Person", "Name"]
  );
  state.relatedById.location = buildIdLookup(
    locationCsv,
    ["Location Record ID", "Record ID", "ID", "_Airtable Record ID"],
    ["Location", "Name"]
  );
  state.relatedById.tag = buildIdLookup(
    tagCsv,
    ["Tag Record ID", "Documents Record ID", "Record ID", "ID", "_Airtable Record ID"],
    ["Tag", "Name"]
  );
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
    const resolvedLocations = resolveRelatedNames("location", [event.location, event.locationFallback]);
    const location = resolvedLocations[0] || "";
    const hasMap = resolvedLocations.some((locationName) => locationHasMap(locationName));

    const resolvedPeople = uniqueCompact(event.people.map((person) => resolveLinkedName("person", person)));
    const fallbackPeople = resolveRelatedNames("person", [event.peopleFallback]);
    const people = resolvedPeople.length > 0 ? resolvedPeople : fallbackPeople;
    const tags = uniqueCompact(
      event.tags
        .map((tag) => cleanTagText(resolveLinkedName("tag", tag)))
        .filter((tag) => isMeaningfulToken(tag))
    );
    const searchableText = [event.searchableText, location, people.join(" "), tags.join(" ")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return {
      ...event,
      location,
      people,
      tags,
      hasMap,
      searchableText
    };
  });
}

function locationHasMap(locationName) {
  const key = normalizeKey(locationName);
  if (!key) {
    return false;
  }
  const location = state.related.location.get(key);
  return Boolean(location && (location.mapEmbedUrl || location.mapOpenUrl));
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

function resolveRecordId(kind, value) {
  const id = sanitizeText(value);
  if (!id) {
    return "";
  }
  const key = normalizeKey(id);
  if (kind === "event") {
    return state.eventNameById.get(key) || "";
  }
  if (kind && state.relatedById[kind]?.has(key)) {
    return state.relatedById[kind].get(key) || "";
  }
  return (
    state.relatedById.person.get(key) ||
    state.relatedById.location.get(key) ||
    state.relatedById.tag.get(key) ||
    ""
  );
}

function resolveLinkedName(kind, value) {
  const text = sanitizeText(value);
  if (!text || !isMeaningfulToken(text)) {
    return "";
  }
  if (!isRecordId(text)) {
    return text;
  }
  const resolved = resolveRecordId(kind, text);
  return isMeaningfulToken(resolved) ? resolved : "";
}

function resolveRecordLookupKey(kind, nameOrId) {
  const text = sanitizeText(nameOrId);
  if (!text) {
    return "";
  }
  if (isRecordId(text)) {
    const resolved = resolveRecordId(kind, text);
    if (resolved) {
      return normalizeKey(resolved);
    }
  }
  return normalizeKey(text);
}

function resolveDisplayToken(value, kind = "") {
  const text = sanitizeText(value);
  if (!text || !isMeaningfulToken(text)) {
    return "";
  }
  if (!isRecordId(text)) {
    return text;
  }
  const resolved = resolveRecordId(kind, text);
  return isMeaningfulToken(resolved) ? resolved : "";
}

function resolveDisplayValue(value, kind = "") {
  const text = sanitizeText(value);
  if (!text) {
    return "";
  }
  const parsed = parseList(text);
  const parts =
    kind === "person" || kind === "location" || kind === "tag"
      ? parseLinkedValues(text, kind)
      : parsed.length > 1
        ? parsed
        : [text];
  const resolved = uniqueCompact(parts.map((part) => resolveDisplayToken(part, kind)));
  return resolved.join(", ");
}

function scrubRecordIdsInText(value) {
  const text = String(value || "");
  return text
    .replace(/\brec[a-z0-9]{10,}\b/gi, (match) => resolveRecordId("", match))
    .replace(/\s*,\s*(?=,)/g, ", ")
    .replace(/(^|[\s([{])[,;:]+(?=\s|$)/g, "$1")
    .replace(/[,;:]+(?=\s*[)\]}])/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function looksLikeErrorPayload(value) {
  const text = sanitizeText(value);
  if (!text) {
    return false;
  }
  const lowered = text.toLowerCase();
  if (lowered.includes("errortype") || lowered.includes("emptydependency") || lowered.includes("#error!")) {
    return true;
  }
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]")) ||
    (text.startsWith("{\"") && text.includes("\"state\""))
  ) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") {
        return false;
      }
      return (
        Object.prototype.hasOwnProperty.call(parsed, "errorType") ||
        Object.prototype.hasOwnProperty.call(parsed, "isStale") ||
        Object.prototype.hasOwnProperty.call(parsed, "state")
      );
    } catch (error) {
      return lowered.includes("state: error") || lowered.includes("value: null");
    }
  }
  return false;
}

function cleanTagText(value) {
  const cleaned = sanitizeText(scrubRecordIdsInText(value || ""));
  if (!cleaned || looksLikeErrorPayload(cleaned)) {
    return "";
  }
  return cleaned;
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
      subtitle: resolveDisplayValue(row["Role in Case"]),
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
        makeDetail("Home / HQ", row["Home / Headquarters"], "location")
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
    const preferredMapUrl =
      sanitizeUrl(row["Google Maps"]) || sanitizeUrl(row["Lat/Lon Google Maps URL"]) || sanitizeUrl(row["Manual Google Maps"]);
    const latitude = parseCoordinate(row.Latitude);
    const longitude = parseCoordinate(row.Longitude);
    const mapEmbedUrl = buildLocationMapEmbedUrl({
      latitude,
      longitude,
      mapUrl: preferredMapUrl
    });
    const mapOpenUrl = preferredMapUrl || buildCoordinateMapUrl(latitude, longitude);
    const downloads = [
      ...attachments.filter((item) => item.type !== "image" && item.type !== "pdf"),
      ...buildLinkDownloads(mapLinks, "Map")
    ].filter((item) => item.type !== "pdf");

    index.set(normalizeKey(name), {
      kind: "location",
      name,
      slug: sanitizeText(row.Slug),
      subtitle: resolveDisplayValue(row.Type),
      summary: sanitizeText(row.Notes),
      images: attachments.filter((item) => item.type === "image"),
      mapEmbedUrl,
      mapOpenUrl,
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
        makeDetail("Located Within", row["Located Within"], "location")
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
      subtitle: cleanTagText(row["Tagged Under"]) || cleanTagText(row["AI: Information Category (Detailed)"]),
      summary: cleanTagText(row.Summary || row["AI: Summary Analysis"]),
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
      details: [makeDetail("Date", cleanTagText(row.Date))].filter(Boolean)
    });
  });
  return index;
}

function makeDetail(label, value, kind = "") {
  const text = resolveDisplayValue(value, kind);
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
    const canonical = eventNameLookup.get(normalizeKey(clean)) || (isRecordId(clean) ? "" : clean);
    if (!canonical) {
      return;
    }
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
  if (!VALID_RECORD_KINDS.has(kind)) {
    return;
  }
  const lookup = state.related[kind];
  const lookupKey = resolveRecordLookupKey(kind, name);
  const record = lookup ? lookup.get(lookupKey) || buildFallbackRecord(kind, name) : buildFallbackRecord(kind, name);

  state.recordModalImages = record.images;
  state.recordModalRelatedEvents = uniqueCompact(
    record.relatedEvents.map((eventName) => {
      if (isRecordId(eventName)) {
        return resolveRecordId("event", eventName);
      }
      return sanitizeText(eventName);
    })
  );
  const subtitleText = scrubRecordIdsInText(record.subtitle || "");
  const titleText =
    resolveDisplayToken(record.name, kind) ||
    (isRecordId(record.name)
      ? kind === "person"
        ? "Unknown Person"
        : kind === "location"
          ? "Unknown Location"
          : "Unknown Tag"
      : record.name);
  dom.recordModalKind.textContent = record.kind.toUpperCase();
  dom.recordModalTitle.textContent = titleText;
  dom.recordModalSubtitle.textContent = subtitleText;
  dom.recordModalSubtitle.hidden = !subtitleText;

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

  if (record.kind === "location" && record.mapEmbedUrl) {
    content.append(buildRecordMapSection(record.mapEmbedUrl, record.mapOpenUrl));
  }

  if (record.downloads.length) {
    content.append(buildRecordDownloadSection(record.downloads));
  }

  content.append(buildRecordConnectionsSection(record.relatedRecords));
  content.append(buildRelatedEventsSection(state.recordModalRelatedEvents));
  dom.recordModal.showModal();
  state.route.recordKind = VALID_RECORD_KINDS.has(kind) ? kind : "";
  state.route.recordName = dom.recordModalTitle.textContent;
  syncUrlState();
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
    mapEmbedUrl: "",
    mapOpenUrl: "",
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
    { kind: "location", label: "Locations", values: relatedRecords?.location || [] }
  ]
    .map((group) => ({
      ...group,
      values: uniqueCompact(group.values.map((value) => resolveDisplayToken(value, group.kind)))
    }))
    .filter((group) => group.values.length > 0);

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
      const chip = buildRecordChip(value, group.kind, value);
      if (chip) {
        list.append(chip);
      }
    });
    if (list.childElementCount > 0) {
      section.append(list);
    }
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

function buildRecordMapSection(embedUrl, openUrl) {
  const section = document.createElement("section");
  section.className = "record-section";

  const heading = document.createElement("h3");
  heading.className = "record-section-title";
  heading.textContent = "Map";
  section.append(heading);

  const frame = document.createElement("iframe");
  frame.className = "record-map-frame";
  frame.loading = "lazy";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "no-referrer-when-downgrade";
  frame.src = embedUrl;
  frame.title = "Location map";
  section.append(frame);

  if (openUrl) {
    const link = document.createElement("a");
    link.className = "record-map-link";
    link.href = openUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open in Google Maps";
    section.append(link);
  }

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
  const cleanEventNames = uniqueCompact(
    eventNames.map((name) => {
      const text = sanitizeText(name);
      if (!text) {
        return "";
      }
      if (isRecordId(text)) {
        return resolveRecordId("event", text);
      }
      return text;
    })
  );

  const section = document.createElement("section");
  section.className = "record-section";

  const heading = document.createElement("h3");
  heading.className = "record-section-title";
  heading.textContent = `Related Events (${cleanEventNames.length})`;
  section.append(heading);

  if (cleanEventNames.length === 0) {
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
  filterButton.textContent = "Filter Timeline";
  section.append(filterButton);

  const list = document.createElement("div");
  list.className = "record-related-list";
  cleanEventNames.forEach((name) => {
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
  state.route.recordKind = "";
  state.route.recordName = "";
  syncUrlState();
}

function focusEventByName(eventName) {
  const name = sanitizeText(eventName);
  if (!name) {
    return;
  }

  state.filters.relatedEventSet = null;
  state.filters.search = name.toLowerCase();
  dom.searchInput.value = name;
  state.route.eventName = name;
  state.route.recordKind = "";
  state.route.recordName = "";
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
    if (parsed.length) {
      return parsed.filter((item) => isMeaningfulToken(item));
    }
    return isMeaningfulToken(text) ? [text] : [];
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

  const normalized = scrubRecordIdsInText(input || "")
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

function sanitizeLinkUrl(value) {
  const clean = stripTrailingUrlPunctuation(String(value || "").trim());
  if (!clean) {
    return "";
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(clean);
  if (!hasScheme && !clean.startsWith("//")) {
    return clean;
  }
  if (/^(mailto:|tel:)/i.test(clean)) {
    return clean;
  }
  return sanitizeUrl(clean);
}

function stripTrailingUrlPunctuation(url) {
  return String(url || "").replace(/[),.;!?]+$/g, "");
}

function parseCoordinate(value) {
  const text = sanitizeText(value);
  if (!text || !/^-?\d{1,3}(?:\.\d+)?$/.test(text)) {
    return null;
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function buildCoordinateMapUrl(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "";
  }
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function getGoogleMapsApiKey() {
  const fromWindow = sanitizeText(window.GOOGLE_MAPS_API || window.__GOOGLE_MAPS_API__);
  if (fromWindow) {
    return fromWindow;
  }
  const fromMeta = sanitizeText(document.querySelector('meta[name="google-maps-api"]')?.content);
  return fromMeta;
}

function buildLocationMapEmbedUrl({ latitude, longitude, mapUrl }) {
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
  const key = getGoogleMapsApiKey();
  if (hasCoords && key) {
    return (
      "https://www.google.com/maps/embed/v1/view?key=" +
      encodeURIComponent(key) +
      `&center=${latitude},${longitude}&zoom=13&maptype=roadmap`
    );
  }
  if (hasCoords) {
    return `https://www.google.com/maps?q=${latitude},${longitude}&output=embed`;
  }

  const cleanUrl = sanitizeUrl(mapUrl);
  if (!cleanUrl) {
    return "";
  }
  try {
    const parsed = new URL(cleanUrl);
    const isGoogleMapDomain = /(?:^|\.)google\./i.test(parsed.hostname) || /maps\.app\.goo\.gl/i.test(parsed.hostname);
    if (!isGoogleMapDomain) {
      return "";
    }
    if (parsed.hostname.includes("maps.app.goo.gl")) {
      return `https://www.google.com/maps?q=${encodeURIComponent(cleanUrl)}&output=embed`;
    }
    if (parsed.searchParams.has("q")) {
      return `https://www.google.com/maps?output=embed&q=${encodeURIComponent(parsed.searchParams.get("q") || "")}`;
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search ? `${parsed.search}&output=embed` : "?output=embed"}`;
  } catch (error) {
    return "";
  }
}

function openModal(mediaItems, index) {
  if (!mediaItems.length) {
    return;
  }
  state.modalMedia = mediaItems;
  state.modalIndex = Number.isFinite(index) ? Math.max(0, Math.min(index, mediaItems.length - 1)) : 0;
  renderModal();
  dom.imageModal.showModal();
}

function closeModal() {
  endModalImageDrag();
  if (document.fullscreenElement === dom.imageModal) {
    document.exitFullscreen().catch(() => {});
  }
  if (dom.imageModal.open) {
    dom.imageModal.close();
  }
}

function shiftModal(direction) {
  if (!state.modalMedia.length) {
    return;
  }
  if (state.modalMedia.length <= 1) {
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
  const label = sanitizeText(item.label) || "Image";
  resetModalImageView();
  dom.modalImage.src = item.url;
  dom.modalImage.alt = label;
  dom.modalImage.draggable = false;
  dom.modalCaption.textContent =
    state.modalMedia.length > 1 ? `${label} (${state.modalIndex + 1}/${state.modalMedia.length})` : label;
  dom.modalPrev.hidden = state.modalMedia.length <= 1;
  dom.modalNext.hidden = state.modalMedia.length <= 1;
  dom.modalPrev.disabled = state.modalMedia.length <= 1;
  dom.modalNext.disabled = state.modalMedia.length <= 1;
  dom.modalOpenOriginal.href = item.url;
  dom.modalOpenOriginal.hidden = !item.url;
  updateModalFullscreenLabel();
}

function resetModalImageView() {
  state.modalView.zoom = 1;
  state.modalView.rotation = 0;
  state.modalView.offsetX = 0;
  state.modalView.offsetY = 0;
  state.modalView.isDragging = false;
  applyModalImageTransform();
}

function applyModalImageTransform() {
  const { zoom, rotation, offsetX, offsetY, isDragging } = state.modalView;
  dom.modalImage.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${zoom}) rotate(${rotation}deg)`;
  dom.modalImage.style.transition = isDragging ? "none" : "transform 120ms ease";
  if (zoom > 1.01) {
    dom.modalImage.style.cursor = isDragging ? "grabbing" : "grab";
  } else {
    dom.modalImage.style.cursor = "zoom-in";
  }
}

function changeModalZoom(delta) {
  const nextZoom = Math.max(1, Math.min(5, state.modalView.zoom + delta));
  state.modalView.zoom = Math.round(nextZoom * 100) / 100;
  if (state.modalView.zoom <= 1) {
    state.modalView.offsetX = 0;
    state.modalView.offsetY = 0;
  }
  applyModalImageTransform();
}

function rotateModalImage(degrees) {
  state.modalView.rotation = (state.modalView.rotation + degrees) % 360;
  applyModalImageTransform();
}

function beginModalImageDrag(event) {
  if (!dom.imageModal.open || state.modalView.zoom <= 1.01) {
    return;
  }
  state.modalView.isDragging = true;
  state.modalView.dragStartX = event.clientX - state.modalView.offsetX;
  state.modalView.dragStartY = event.clientY - state.modalView.offsetY;
  dom.modalImage.setPointerCapture(event.pointerId);
  applyModalImageTransform();
}

function dragModalImage(event) {
  if (!state.modalView.isDragging || state.modalView.zoom <= 1.01) {
    return;
  }
  state.modalView.offsetX = event.clientX - state.modalView.dragStartX;
  state.modalView.offsetY = event.clientY - state.modalView.dragStartY;
  applyModalImageTransform();
}

function endModalImageDrag(event) {
  if (!state.modalView.isDragging) {
    return;
  }
  state.modalView.isDragging = false;
  if (event && dom.modalImage.hasPointerCapture(event.pointerId)) {
    dom.modalImage.releasePointerCapture(event.pointerId);
  }
  applyModalImageTransform();
}

async function toggleModalFullscreen() {
  const target = dom.imageModal;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (typeof target.requestFullscreen === "function") {
      await target.requestFullscreen();
    }
  } catch (error) {
    // Ignore fullscreen API failures in unsupported environments.
  } finally {
    updateModalFullscreenLabel();
  }
}

function updateModalFullscreenLabel() {
  const inFullscreen = document.fullscreenElement === dom.imageModal;
  dom.modalFullscreen.textContent = inFullscreen ? "Exit Fullscreen" : "Fullscreen";
}

function syncUrlState() {
  if (state.suppressUrlSync) {
    return;
  }
  const params = new URLSearchParams();
  const searchText = sanitizeText(dom.searchInput.value);
  if (searchText) {
    params.set("q", searchText);
  }
  (state.filters.locations || []).forEach((location) => params.append("loc", location));
  (state.filters.people || []).forEach((person) => params.append("person", person));
  (state.filters.tags || []).forEach((tag) => params.append("tag", tag));
  if (state.filters.mediaOnly) {
    params.set("media", "1");
  }
  if (state.route.eventName) {
    params.set("event", state.route.eventName);
  }
  if (state.route.recordKind && state.route.recordName) {
    params.set("recordKind", state.route.recordKind);
    params.set("record", state.route.recordName);
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const searchText = sanitizeText(params.get("q"));
  state.filters.search = searchText.toLowerCase();
  dom.searchInput.value = searchText;

  state.filters.locations = parseFilterValuesFromUrl(params, ["loc"], "location");
  state.filters.locations = filterExistingOptionValues(dom.locationFilter, state.filters.locations);
  setSelectedSelectValues(dom.locationFilter, state.filters.locations);

  state.filters.people = parseFilterValuesFromUrl(params, ["person", "people"], "person");
  state.filters.people = filterExistingOptionValues(dom.peopleFilter, state.filters.people);
  setSelectedSelectValues(dom.peopleFilter, state.filters.people);

  if (dom.tagFilter) {
    state.filters.tags = parseFilterValuesFromUrl(params, ["tag", "tags"], "tag");
    state.filters.tags = filterExistingOptionValues(dom.tagFilter, state.filters.tags);
    setSelectedSelectValues(dom.tagFilter, state.filters.tags);
  } else {
    state.filters.tags = [];
  }

  state.filters.mediaOnly = sanitizeText(params.get("media")) === "1";
  dom.mediaOnlyFilter.checked = state.filters.mediaOnly;
  state.filters.relatedEventSet = null;

  const eventParam = sanitizeText(params.get("event"));
  state.route.eventName = isRecordId(eventParam) ? resolveRecordId("event", eventParam) : eventParam;

  const recordKind = sanitizeText(params.get("recordKind")).toLowerCase();
  const recordParam = sanitizeText(params.get("record"));
  state.route.recordKind = VALID_RECORD_KINDS.has(recordKind) ? recordKind : "";
  state.route.recordName =
    state.route.recordKind && isRecordId(recordParam) ? resolveRecordId(state.route.recordKind, recordParam) : recordParam;
  if (!state.route.recordKind) {
    state.route.recordName = "";
  }
}

function applyRouteFromUrl() {
  if (state.route.eventName) {
    if (!openEventDetailsByName(state.route.eventName)) {
      const matchedEventName = resolveEventRouteName(state.route.eventName);
      if (matchedEventName) {
        state.filters.locations = [];
        state.filters.people = [];
        state.filters.tags = [];
        state.filters.mediaOnly = false;
        clearSelectSelection(dom.locationFilter);
        clearSelectSelection(dom.peopleFilter);
        if (dom.tagFilter) {
          clearSelectSelection(dom.tagFilter);
        }
        dom.mediaOnlyFilter.checked = false;
        state.filters.search = matchedEventName.toLowerCase();
        dom.searchInput.value = matchedEventName;
        applyFilters();
        openEventDetailsByName(matchedEventName);
      }
    }
  }

  if (state.route.recordKind && state.route.recordName) {
    openRecordModal(state.route.recordKind, state.route.recordName);
  }
}

function openEventDetailsByName(name) {
  const eventName = resolveEventRouteName(name);
  if (!eventName) {
    return false;
  }
  const eventKey = normalizeKey(eventName);
  const details = [...dom.timeline.querySelectorAll("details.event-item")].find(
    (item) => item.dataset.eventNameKey === eventKey
  );
  if (!details) {
    return false;
  }
  details.open = true;
  details.scrollIntoView({ block: "center", behavior: state.suppressUrlSync ? "auto" : "smooth" });
  state.route.eventName = eventName;
  return true;
}

function resolveEventRouteName(value) {
  const text = sanitizeText(value);
  if (!text) {
    return "";
  }
  if (isRecordId(text)) {
    return resolveRecordId("event", text);
  }
  const key = normalizeKey(text);
  const event = state.events.find((item) => normalizeKey(item.eventName) === key);
  return event ? event.eventName : text;
}

function findEventNameByKey(eventNameKey) {
  const key = normalizeKey(eventNameKey);
  if (!key) {
    return "";
  }
  const event = state.events.find((item) => normalizeKey(item.eventName) === key);
  return event ? event.eventName : "";
}

function bindMultiSelectToggle(select) {
  if (!select || !select.multiple) {
    return;
  }
  select.addEventListener("mousedown", (event) => {
    const option = event.target instanceof HTMLOptionElement ? event.target : null;
    if (!option) {
      return;
    }
    event.preventDefault();
    option.selected = !option.selected;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function getSelectedSelectValues(select) {
  if (!select) {
    return [];
  }
  return [...select.selectedOptions].map((option) => sanitizeText(option.value)).filter(Boolean);
}

function setSelectedSelectValues(select, values) {
  if (!select) {
    return;
  }
  const selectedKeys = new Set((values || []).map((value) => normalizeKey(value)));
  [...select.options].forEach((option) => {
    option.selected = selectedKeys.has(normalizeKey(option.value));
  });
}

function clearSelectSelection(select) {
  if (!select) {
    return;
  }
  [...select.options].forEach((option) => {
    option.selected = false;
  });
}

function filterExistingOptionValues(select, values) {
  if (!select) {
    return [];
  }
  const existingValues = new Map([...select.options].map((option) => [normalizeKey(option.value), option.value]));
  const resolved = [];
  (values || []).forEach((value) => {
    const key = normalizeKey(value);
    if (existingValues.has(key)) {
      resolved.push(existingValues.get(key));
    }
  });
  return uniqueCompact(resolved);
}

function parseFilterValuesFromUrl(params, keys, kind) {
  const values = [];
  keys.forEach((key) => {
    const rawValues = params.getAll(key);
    rawValues.forEach((rawValue) => {
      const parts = String(rawValue || "").includes("|") ? String(rawValue).split("|") : [rawValue];
      parts.forEach((item) => {
        const clean = sanitizeText(item);
        if (!clean) {
          return;
        }
        const resolved = isRecordId(clean) ? resolveRecordId(kind, clean) : clean;
        if (resolved) {
          values.push(resolved);
        }
      });
    });
  });
  return uniqueCompact(values);
}

function renderDataFreshness(metadata) {
  if (!dom.dataFreshness) {
    return;
  }
  const rawTimestamp = sanitizeText(metadata?.generated_at_utc || metadata?.sync_cursor_utc);
  if (!rawTimestamp) {
    return;
  }
  const parsed = new Date(rawTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return;
  }
  const timestamp = parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const syncMode = sanitizeText(metadata?.sync_mode);
  dom.dataFreshness.textContent = syncMode ? `Data refreshed ${timestamp} (${syncMode})` : `Data refreshed ${timestamp}`;
  dom.dataFreshness.hidden = false;
}

function renderLoadError(error = null) {
  dom.timeline.replaceChildren();
  const errorItem = document.createElement("li");
  errorItem.className = "empty-state";

  const title = document.createElement("h2");
  title.textContent = "Could not load timeline data.";

  const message = document.createElement("p");
  message.textContent = "Check that data/events-timeline.csv exists and reload.";

  const details = formatLoadErrorDetails(error);
  if (details) {
    const detailLine = document.createElement("p");
    detailLine.textContent = `Detail: ${details}`;
    errorItem.append(title, message, detailLine, ...buildLoadErrorHints());
    dom.timeline.append(errorItem);
    return;
  }

  const hints = buildLoadErrorHints();
  errorItem.append(title, message, ...hints);
  dom.timeline.append(errorItem);
}

function formatLoadErrorDetails(error) {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return sanitizeText(error);
  }
  const message = sanitizeText(error.message || "");
  if (!message) {
    return "";
  }
  return message;
}

function buildLoadErrorHints() {
  const hints = [];
  if (window.location.protocol === "file:") {
    const hint = document.createElement("p");
    hint.textContent =
      "Detected file:// access. Run a local server (python3 -m http.server 4173) and open http://localhost:4173 instead.";
    hints.push(hint);
    return hints;
  }

  const path = sanitizeText(window.location.pathname);
  if (path && path !== "/" && !path.endsWith(".html")) {
    const rootHint = document.createElement("p");
    rootHint.textContent = `Current path is ${path}. If this URL is rewritten, try loading the site root directly.`;
    hints.push(rootHint);
  }
  return hints;
}

function capitalize(value) {
  if (!value) {
    return "Attachment";
  }
  return value[0].toUpperCase() + value.slice(1);
}
