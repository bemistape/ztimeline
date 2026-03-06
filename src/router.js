import { normalizeKey, normalizeText, recordKindToView, stripRouteEmpty } from "./utils.js";

const VALID_VIEWS = new Set(["overview", "timeline", "people", "locations", "tags", "about"]);
const VALID_RECORD_KINDS = new Set(["person", "location", "tag"]);

export function createDefaultRoute() {
  return {
    view: "overview",
    filters: {
      q: "",
      types: [],
      years: [],
      locations: [],
      people: [],
      tags: [],
      mediaOnly: false,
    },
    selection: {
      eventId: "",
      recordKind: "",
      recordId: "",
    },
  };
}

export function parseRoute(searchString) {
  const route = createDefaultRoute();
  const params = new URLSearchParams(searchString || "");
  const requestedView = normalizeKey(params.get("view"));
  route.view = VALID_VIEWS.has(requestedView) ? requestedView : inferView(params);

  route.filters.q = normalizeText(params.get("q"));
  route.filters.types = uniqueParams(params, ["type"]);
  route.filters.years = uniqueParams(params, ["year"]);
  route.filters.locations = uniqueParams(params, ["loc"]);
  route.filters.people = uniqueParams(params, ["person", "people"]);
  route.filters.tags = uniqueParams(params, ["tag", "tags"]);
  route.filters.mediaOnly = normalizeText(params.get("media")) === "1";

  route.selection.eventId = normalizeText(params.get("event"));
  const recordKind = normalizeKey(params.get("recordKind"));
  route.selection.recordKind = VALID_RECORD_KINDS.has(recordKind) ? recordKind : "";
  route.selection.recordId = route.selection.recordKind ? normalizeText(params.get("record")) : "";

  if (route.selection.recordKind && route.view === "overview") {
    route.view = recordKindToView(route.selection.recordKind);
  }
  if (route.selection.eventId && route.view === "overview") {
    route.view = "timeline";
  }

  return route;
}

export function buildSearchString(route) {
  const params = new URLSearchParams();
  const view = normalizeKey(route?.view);
  const filters = stripRouteEmpty(route?.filters);
  const selection = route?.selection || {};

  if (view && view !== "overview") {
    params.set("view", view);
  }
  if (filters.q) {
    params.set("q", filters.q);
  }
  filters.types.forEach((value) => params.append("type", value));
  filters.years.forEach((value) => params.append("year", value));
  filters.locations.forEach((value) => params.append("loc", value));
  filters.people.forEach((value) => params.append("person", value));
  filters.tags.forEach((value) => params.append("tag", value));
  if (filters.mediaOnly) {
    params.set("media", "1");
  }
  if (normalizeText(selection.eventId)) {
    params.set("event", normalizeText(selection.eventId));
  }
  if (normalizeText(selection.recordKind) && normalizeText(selection.recordId)) {
    params.set("recordKind", normalizeText(selection.recordKind));
    params.set("record", normalizeText(selection.recordId));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function resetTimelineFilters(route) {
  return {
    ...route,
    filters: {
      q: "",
      types: [],
      years: [],
      locations: [],
      people: [],
      tags: [],
      mediaOnly: false,
    },
  };
}

function uniqueParams(params, keys) {
  const items = [];
  const seen = new Set();
  keys.forEach((key) => {
    params.getAll(key).forEach((rawValue) => {
      const values = String(rawValue || "").includes("|") ? String(rawValue).split("|") : [rawValue];
      values.forEach((value) => {
        const clean = normalizeText(value);
        const dedupeKey = normalizeKey(clean);
        if (!dedupeKey || seen.has(dedupeKey)) {
          return;
        }
        seen.add(dedupeKey);
        items.push(clean);
      });
    });
  });
  return items;
}

function inferView(params) {
  const recordKind = normalizeKey(params.get("recordKind"));
  if (VALID_RECORD_KINDS.has(recordKind)) {
    return recordKindToView(recordKind);
  }
  if (normalizeText(params.get("event"))) {
    return "timeline";
  }
  if (
    params.has("q") ||
    params.has("type") ||
    params.has("year") ||
    params.has("loc") ||
    params.has("person") ||
    params.has("people") ||
    params.has("tag") ||
    params.has("tags") ||
    params.get("media") === "1"
  ) {
    return "timeline";
  }
  return "overview";
}
