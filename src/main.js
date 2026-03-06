import { loadEvents, loadLocations, loadPeople, loadShellBundle, loadTags } from "./data.js";
import { buildSearchString, createDefaultRoute, parseRoute, resetTimelineFilters } from "./router.js";
import { searchIndex } from "./search.js";
import { recordKindToView, viewToRecordKind, normalizeKey, normalizeText, toggleListValue } from "./utils.js";
import { renderHeader, renderFooter, renderDetailPanel, renderMediaDialog } from "./views/components.js";
import { renderOverview } from "./views/overview.js";
import { renderTimeline } from "./views/timeline.js";
import { renderDirectory } from "./views/directory.js";
import { renderAbout } from "./views/about.js";

const dom = {
  header: document.getElementById("site-header"),
  app: document.getElementById("app"),
  footer: document.getElementById("site-footer"),
  detailPanel: document.getElementById("detail-panel"),
  detailOverlay: document.getElementById("detail-overlay"),
  mediaDialog: document.getElementById("media-dialog"),
};

const state = {
  route: parseRoute(window.location.search),
  shell: null,
  overview: null,
  searchIndex: [],
  datasets: {
    events: null,
    people: null,
    locations: null,
    tags: null,
  },
  ui: {
    openFacet: "",
    facetQueries: {
      types: "",
      years: "",
      locations: "",
      people: "",
      tags: "",
    },
    globalSearch: {
      query: "",
      groups: [],
      flat: [],
      open: false,
      activeIndex: 0,
    },
    media: {
      open: false,
      items: [],
      index: 0,
    },
    scrollTarget: "",
  },
};

export async function bootstrap() {
  bindEvents();
  const shellBundle = await loadShellBundle();
  state.shell = shellBundle.shell;
  state.overview = shellBundle.overview;
  state.searchIndex = shellBundle.searchIndex;
  await ensureRouteData();
  render();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    void handleClick(event);
  });
  document.addEventListener("input", (event) => {
    void handleInput(event);
  });
  document.addEventListener("change", (event) => {
    void handleChange(event);
  });
  document.addEventListener("keydown", (event) => {
    void handleKeydown(event);
  });
  window.addEventListener("popstate", () => {
    state.route = parseRoute(window.location.search);
    state.ui.openFacet = "";
    state.ui.globalSearch.open = false;
    state.ui.globalSearch.query = "";
    void ensureRouteData().then(() => render());
  });
  if (dom.mediaDialog) {
    dom.mediaDialog.addEventListener("close", () => {
      if (state.ui.media.open) {
        state.ui.media.open = false;
        render();
      }
    });
  }
}

async function handleClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  let dismissedUi = false;

  if (!target.closest("[data-facet]")) {
    state.ui.openFacet = "";
    dismissedUi = true;
  }
  if (!target.closest("[data-search-root]")) {
    state.ui.globalSearch.open = false;
    dismissedUi = true;
  }

  const overlay = target.closest("#detail-overlay");
  if (overlay) {
    clearSelection();
    render();
    return;
  }

  const nav = target.closest("[data-nav-view]");
  if (nav) {
    const view = nav.getAttribute("data-nav-view");
    if (view) {
      await navigateToView(view);
    }
    return;
  }

  const searchSelect = target.closest("[data-search-select]");
  if (searchSelect) {
    const token = searchSelect.getAttribute("data-search-select") || "";
    const [kind, id] = token.split(":");
    const entry = state.ui.globalSearch.flat.find((item) => item.kind === kind && item.id === id);
    if (entry) {
      await selectSearchEntry(entry);
    }
    return;
  }

  const openEvent = target.closest("[data-open-event]");
  if (openEvent) {
    const eventId = openEvent.getAttribute("data-open-event");
    if (eventId) {
      await openEventById(eventId, { clearFilters: false });
    }
    return;
  }

  const openRecord = target.closest("[data-open-record-kind]");
  if (openRecord) {
    const kind = openRecord.getAttribute("data-open-record-kind");
    const recordId = openRecord.getAttribute("data-open-record-id");
    if (kind && recordId) {
      await openRecordById(kind, recordId);
    }
    return;
  }

  const closeDetail = target.closest("[data-close-detail]");
  if (closeDetail) {
    clearSelection();
    render();
    return;
  }

  const toggleFacet = target.closest("[data-toggle-facet]");
  if (toggleFacet) {
    const facet = toggleFacet.getAttribute("data-toggle-facet") || "";
    state.ui.openFacet = state.ui.openFacet === facet ? "" : facet;
    render();
    return;
  }

  const removeFilter = target.closest("[data-remove-filter]");
  if (removeFilter) {
    const token = removeFilter.getAttribute("data-remove-filter") || "";
    removeFilterToken(token);
    render();
    syncUrl();
    return;
  }

  if (target.closest("[data-clear-search]")) {
    state.route.filters.q = "";
    render();
    syncUrl();
    return;
  }

  if (target.closest("[data-clear-filters]")) {
    state.route = {
      ...resetTimelineFilters(state.route),
      selection: createDefaultRoute().selection,
      view: "timeline",
    };
    render();
    syncUrl();
    return;
  }

  const jumpYear = target.closest("[data-jump-year]");
  if (jumpYear) {
    const year = jumpYear.getAttribute("data-jump-year") || "";
    if (state.route.view !== "timeline") {
      state.route = {
        ...createDefaultRoute(),
        view: "timeline",
        filters: { ...createDefaultRoute().filters, years: [year] },
        selection: createDefaultRoute().selection,
      };
      await ensureRouteData();
      render();
      syncUrl();
      return;
    }
    scrollToTarget(`year-${year}`);
    return;
  }

  const applyType = target.closest("[data-apply-type]");
  if (applyType) {
    const type = applyType.getAttribute("data-apply-type") || "";
    state.route = {
      ...createDefaultRoute(),
      view: "timeline",
      filters: { ...createDefaultRoute().filters, types: [type] },
      selection: createDefaultRoute().selection,
    };
    await ensureRouteData();
    render();
    syncUrl();
    return;
  }

  const openRelatedEvents = target.closest("[data-open-related-events]");
  if (openRelatedEvents) {
    const token = openRelatedEvents.getAttribute("data-open-related-events") || "";
    const [kind, id] = token.split(":");
    const selected = getSelectedItem();
    const value = selected?.title || "";
    state.route = {
      ...createDefaultRoute(),
      view: "timeline",
      filters: {
        ...createDefaultRoute().filters,
        people: kind === "person" ? [value] : [],
        locations: kind === "location" ? [value] : [],
        tags: kind === "tag" ? [value] : [],
      },
      selection: createDefaultRoute().selection,
    };
    await ensureRouteData();
    render();
    syncUrl();
    return;
  }

  const openMedia = target.closest("[data-open-media]");
  if (openMedia) {
    const context = openMedia.getAttribute("data-open-media") || "";
    const index = Number.parseInt(openMedia.getAttribute("data-media-index") || "0", 10) || 0;
    openMediaByContext(context, index);
    render();
    return;
  }

  if (target.closest("[data-close-media]")) {
    closeMedia();
    render();
    return;
  }

  const shiftMedia = target.closest("[data-shift-media]");
  if (shiftMedia) {
    const delta = Number.parseInt(shiftMedia.getAttribute("data-shift-media") || "0", 10);
    shiftMediaIndex(delta);
    render();
    return;
  }

  if (dismissedUi) {
    render();
  }
}

async function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.hasAttribute("data-global-search")) {
    state.ui.globalSearch.query = target.value;
    const results = searchIndex(state.searchIndex, target.value, { limitPerKind: 3, overallLimit: 12 });
    state.ui.globalSearch.groups = results.groups;
    state.ui.globalSearch.flat = results.flat;
    state.ui.globalSearch.activeIndex = 0;
    state.ui.globalSearch.open = true;
    render({ preserveFocus: true });
    return;
  }

  if (target.hasAttribute("data-view-search")) {
    state.route.filters.q = target.value;
    render({ preserveFocus: true });
    syncUrl();
    return;
  }

  const facet = target.getAttribute("data-facet-search");
  if (facet) {
    state.ui.facetQueries[facet] = target.value;
    render({ preserveFocus: true });
  }
}

async function handleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  if (target.hasAttribute("data-media-only")) {
    state.route.filters.mediaOnly = target.checked;
    render();
    syncUrl();
    return;
  }
  const facet = target.getAttribute("data-facet-checkbox");
  if (facet) {
    const key = facet;
    state.route.filters[key] = toggleListValue(state.route.filters[key], target.value);
    render({ preserveFocus: true });
    syncUrl();
  }
}

async function handleKeydown(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.hasAttribute("data-global-search")) {
    if (!state.ui.globalSearch.flat.length) {
      if (event.key === "Escape") {
        state.ui.globalSearch.open = false;
        render({ preserveFocus: true });
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.ui.globalSearch.activeIndex = Math.min(state.ui.globalSearch.flat.length - 1, state.ui.globalSearch.activeIndex + 1);
      render({ preserveFocus: true });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.ui.globalSearch.activeIndex = Math.max(0, state.ui.globalSearch.activeIndex - 1);
      render({ preserveFocus: true });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const entry = state.ui.globalSearch.flat[state.ui.globalSearch.activeIndex] || state.ui.globalSearch.flat[0];
      if (entry) {
        await selectSearchEntry(entry);
      }
      return;
    }
    if (event.key === "Escape") {
      state.ui.globalSearch.open = false;
      render({ preserveFocus: true });
      return;
    }
  }

  if (event.key === "Escape") {
    if (state.ui.media.open) {
      closeMedia();
      render();
      return;
    }
    if (hasSelection()) {
      clearSelection();
      render();
      return;
    }
    if (state.ui.openFacet) {
      state.ui.openFacet = "";
      render();
      return;
    }
  }
}

async function selectSearchEntry(entry) {
  state.ui.globalSearch.open = false;
  state.ui.globalSearch.query = "";
  if (entry.kind === "event") {
    await openEventById(entry.id, { clearFilters: true });
    return;
  }
  await openRecordById(entry.kind, entry.id);
}

async function navigateToView(view) {
  const cleanView = normalizeText(view);
  if (!cleanView) {
    return;
  }
  state.route = {
    ...createDefaultRoute(),
    view: cleanView,
  };
  await ensureRouteData();
  render();
  syncUrl();
}

async function openEventById(eventId, options = {}) {
  await ensureDataset("events");
  state.route.view = "timeline";
  if (options.clearFilters) {
    state.route.filters = createDefaultRoute().filters;
  }
  state.route.selection = {
    eventId,
    recordKind: "",
    recordId: "",
  };
  render();
  syncUrl();
  scrollToEvent(eventId);
}

async function openRecordById(kind, recordId) {
  const recordKind = normalizeText(kind);
  const view = recordKindToView(recordKind);
  await ensureDataset(view);
  state.route = {
    ...state.route,
    view,
    filters: createDefaultRoute().filters,
    selection: {
      eventId: "",
      recordKind,
      recordId,
    },
  };
  render();
  syncUrl();
}

function clearSelection() {
  state.route.selection = createDefaultRoute().selection;
}

function hasSelection() {
  return Boolean(state.route.selection.eventId || state.route.selection.recordId);
}

async function ensureRouteData() {
  if (state.route.view === "timeline" || state.route.selection.eventId) {
    await ensureDataset("events");
  }
  if (state.route.view === "people" || state.route.selection.recordKind === "person") {
    await ensureDataset("people");
  }
  if (state.route.view === "locations" || state.route.selection.recordKind === "location") {
    await ensureDataset("locations");
  }
  if (state.route.view === "tags" || state.route.selection.recordKind === "tag") {
    await ensureDataset("tags");
  }
}

async function ensureDataset(kind) {
  if (kind === "timeline") {
    return ensureDataset("events");
  }
  if (kind === "people") {
    if (!state.datasets.people) {
      state.datasets.people = await loadPeople();
    }
    return;
  }
  if (kind === "locations") {
    if (!state.datasets.locations) {
      state.datasets.locations = await loadLocations();
    }
    return;
  }
  if (kind === "tags") {
    if (!state.datasets.tags) {
      state.datasets.tags = await loadTags();
    }
    return;
  }
  if (kind === "events") {
    if (!state.datasets.events) {
      state.datasets.events = await loadEvents();
    }
  }
}

function render(options = {}) {
  const focusState = options.preserveFocus ? captureFocusState() : null;
  dom.header.innerHTML = renderHeader({
    shell: state.shell,
    route: state.route,
    searchState: state.ui.globalSearch,
    searchGroups: state.ui.globalSearch.open ? state.ui.globalSearch.groups : [],
    activeResult: state.ui.globalSearch.flat[state.ui.globalSearch.activeIndex] || null,
  });
  dom.app.innerHTML = renderCurrentView();
  dom.footer.innerHTML = renderFooter({ shell: state.shell });

  const selected = getSelectedItem();
  dom.detailPanel.innerHTML = selected ? renderDetailPanel({ selection: state.route.selection, item: selected, shell: state.shell }) : "";
  dom.detailPanel.hidden = !selected;
  dom.detailOverlay.hidden = !selected;

  syncMediaDialog();
  if (focusState) {
    restoreFocusState(focusState);
  }
}

function renderCurrentView() {
  if (state.route.view === "overview") {
    return renderOverview({ shell: state.shell, overview: state.overview });
  }
  if (state.route.view === "timeline") {
    return renderTimeline({ eventsData: state.datasets.events, route: state.route, ui: state.ui });
  }
  if (state.route.view === "people") {
    return renderDirectory({ view: "people", payload: state.datasets.people, route: state.route });
  }
  if (state.route.view === "locations") {
    return renderDirectory({ view: "locations", payload: state.datasets.locations, route: state.route });
  }
  if (state.route.view === "tags") {
    return renderDirectory({ view: "tags", payload: state.datasets.tags, route: state.route });
  }
  return renderAbout({ shell: state.shell, overview: state.overview });
}

function getSelectedItem() {
  if (state.route.selection.eventId) {
    return findItem(state.datasets.events?.items || [], state.route.selection.eventId);
  }
  if (state.route.selection.recordKind && state.route.selection.recordId) {
    const payload = getPayloadByKind(state.route.selection.recordKind);
    return findItem(payload?.items || [], state.route.selection.recordId);
  }
  return null;
}

function getPayloadByKind(kind) {
  if (kind === "person") {
    return state.datasets.people;
  }
  if (kind === "location") {
    return state.datasets.locations;
  }
  if (kind === "tag") {
    return state.datasets.tags;
  }
  return null;
}

function findItem(items, key) {
  const cleanKey = normalizeKey(key);
  return (items || []).find((item) => {
    return [item.id, item.slug, item.title].some((value) => normalizeKey(value) === cleanKey);
  }) || null;
}

function removeFilterToken(token) {
  const [facet, rawValue] = token.split(":");
  const value = normalizeText(rawValue);
  if (facet === "mediaOnly") {
    state.route.filters.mediaOnly = false;
    return;
  }
  state.route.filters[facet] = (state.route.filters[facet] || []).filter((item) => normalizeKey(item) !== normalizeKey(value));
}

function syncUrl() {
  const nextSearch = buildSearchString(state.route);
  const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function captureFocusState() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement)) {
    return null;
  }
  return {
    key: active.getAttribute("data-focus-key"),
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

function restoreFocusState(stateValue) {
  if (!stateValue?.key) {
    return;
  }
  const target = document.querySelector(`[data-focus-key="${CSS.escape(stateValue.key)}"]`);
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  target.focus();
  if (typeof stateValue.start === "number" && typeof stateValue.end === "number") {
    target.setSelectionRange(stateValue.start, stateValue.end);
  }
}

function openMediaByContext(context, index) {
  const [kind, id] = String(context || "").split(":");
  let item = null;
  if (kind === "event") {
    item = findItem(state.datasets.events?.items || [], id);
  } else if (kind === "person") {
    item = findItem(state.datasets.people?.items || [], id);
  } else if (kind === "location") {
    item = findItem(state.datasets.locations?.items || [], id);
  } else if (kind === "tag") {
    item = findItem(state.datasets.tags?.items || [], id);
  }
  const items = item?.images || [];
  if (!items.length) {
    return;
  }
  state.ui.media.open = true;
  state.ui.media.items = items;
  state.ui.media.index = Math.max(0, Math.min(index, items.length - 1));
}

function closeMedia() {
  state.ui.media.open = false;
  state.ui.media.items = [];
  state.ui.media.index = 0;
  if (dom.mediaDialog?.open) {
    dom.mediaDialog.close();
  }
}

function shiftMediaIndex(delta) {
  const items = state.ui.media.items || [];
  if (!items.length) {
    return;
  }
  const total = items.length;
  state.ui.media.index = (state.ui.media.index + delta + total) % total;
}

function syncMediaDialog() {
  if (!dom.mediaDialog) {
    return;
  }
  if (!state.ui.media.open || !state.ui.media.items.length) {
    if (dom.mediaDialog.open) {
      dom.mediaDialog.close();
    }
    dom.mediaDialog.innerHTML = "";
    return;
  }
  const current = state.ui.media.items[state.ui.media.index];
  dom.mediaDialog.innerHTML = renderMediaDialog({
    open: true,
    current,
    index: state.ui.media.index,
    total: state.ui.media.items.length,
  });
  if (!dom.mediaDialog.open) {
    dom.mediaDialog.showModal();
  }
}

function scrollToTarget(id) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function scrollToEvent(eventId) {
  requestAnimationFrame(() => {
    const button = document.querySelector(`[data-open-event="${CSS.escape(eventId)}"]`);
    if (button instanceof HTMLElement) {
      button.closest("[data-event-card], .archive-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}
