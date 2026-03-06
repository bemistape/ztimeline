import { buildEmptyState, escapeHtml, flattenRefs, normalizeKey } from "../utils.js";
import { renderFacetMenu, renderFilterChips, renderSectionHeader, renderTimelineEventCard } from "./components.js";

export function renderTimeline({ eventsData, route, ui }) {
  if (!eventsData) {
    return `<section class="loading-state"><p>Loading timeline…</p></section>`;
  }
  const filteredItems = filterEvents(eventsData.items || [], route.filters);
  const groups = groupEventsByYear(filteredItems);
  const years = groups.map((group) => group.year);
  return `
    <section class="timeline-view">
      ${renderSectionHeader({
        kicker: "Timeline",
        title: "Chronology first, context close behind",
        copy: "Dates and times lead the page, while people, places, tags, and media stay one step away instead of competing with the timeline.",
      })}

      <section class="timeline-controls">
        <div class="timeline-controls-top">
          <label class="view-search">
            <span>Search timeline</span>
            <input
              type="search"
              data-focus-key="view-search"
              data-view-search
              value="${escapeHtml(route.filters.q)}"
              placeholder="Search titles, descriptions, people, locations, and tags"
            />
          </label>
          <label class="toggle-check">
            <input type="checkbox" data-media-only ${route.filters.mediaOnly ? "checked" : ""} />
            <span>Only with media</span>
          </label>
        </div>

        <div class="facet-row">
          ${renderFacetMenu({
            facet: "types",
            label: "Type",
            options: eventsData.facets?.types || [],
            selectedValues: route.filters.types,
            openFacet: ui.openFacet,
            query: ui.facetQueries.types || "",
          })}
          ${renderFacetMenu({
            facet: "years",
            label: "Year",
            options: eventsData.facets?.years || [],
            selectedValues: route.filters.years,
            openFacet: ui.openFacet,
            query: ui.facetQueries.years || "",
          })}
          ${renderFacetMenu({
            facet: "locations",
            label: "Location",
            options: eventsData.facets?.locations || [],
            selectedValues: route.filters.locations,
            openFacet: ui.openFacet,
            query: ui.facetQueries.locations || "",
          })}
          ${renderFacetMenu({
            facet: "people",
            label: "People",
            options: eventsData.facets?.people || [],
            selectedValues: route.filters.people,
            openFacet: ui.openFacet,
            query: ui.facetQueries.people || "",
          })}
          ${renderFacetMenu({
            facet: "tags",
            label: "Tags",
            options: eventsData.facets?.tags || [],
            selectedValues: route.filters.tags,
            openFacet: ui.openFacet,
            query: ui.facetQueries.tags || "",
          })}
        </div>

        ${renderFilterChips(route.filters)}
      </section>

      <section class="timeline-summary">
        <p><strong>${escapeHtml(String(filteredItems.length))}</strong> event${filteredItems.length === 1 ? "" : "s"} shown</p>
        ${
          years.length
            ? `
              <div class="year-jump-row">
                ${years
                  .map(
                    (year) => `
                      <button class="year-jump-pill" type="button" data-jump-year="${escapeHtml(String(year))}">
                        ${escapeHtml(String(year))}
                      </button>
                    `
                  )
                  .join("")}
              </div>
            `
            : ""
        }
      </section>

      ${
        filteredItems.length
          ? `
            <div class="timeline-year-groups">
              ${groups
                .map(
                  (group) => `
                    <section class="year-group" id="year-${escapeHtml(String(group.year))}">
                      <header class="year-group-header">
                        <div>
                          <p class="section-kicker">Year</p>
                          <h2>${escapeHtml(String(group.year))}</h2>
                        </div>
                        <p>${escapeHtml(String(group.items.length))} event${group.items.length === 1 ? "" : "s"}</p>
                      </header>
                      <div class="timeline-day-stack">
                        ${groupEventsByDate(group.items)
                          .map((item) =>
                            renderDateGroup(item, route)
                          )
                          .join("")}
                      </div>
                    </section>
                  `
                )
                .join("")}
            </div>
          `
          : buildEmptyState("No timeline events match these filters.", "Try clearing one or more facets or search terms.")
      }
    </section>
  `;
}

export function filterEvents(items, filters) {
  return (items || []).filter((item) => {
    if (filters.mediaOnly && !item.hasMedia) {
      return false;
    }
    if (filters.q && !normalizeKey(item.searchText).includes(normalizeKey(filters.q))) {
      return false;
    }
    if (filters.types.length && !filters.types.some((value) => normalizeKey(value) === normalizeKey(item.type))) {
      return false;
    }
    if (filters.years.length && !filters.years.some((value) => String(value) === String(item.year))) {
      return false;
    }
    if (filters.locations.length && !filters.locations.some((value) => flattenRefs(item.locations).map(normalizeKey).includes(normalizeKey(value)))) {
      return false;
    }
    if (filters.people.length && !filters.people.some((value) => flattenRefs(item.people).map(normalizeKey).includes(normalizeKey(value)))) {
      return false;
    }
    if (filters.tags.length && !filters.tags.some((value) => flattenRefs(item.tags).map(normalizeKey).includes(normalizeKey(value)))) {
      return false;
    }
    return true;
  });
}

function groupEventsByYear(items) {
  const groups = [];
  let current = null;
  items.forEach((item) => {
    const year = item.year || "Unknown";
    if (!current || current.year !== year) {
      current = { year, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  });
  return groups;
}

function groupEventsByDate(items) {
  const groups = [];
  let current = null;
  items.forEach((item) => {
    const key = item.date || "unknown";
    if (!current || current.key !== key) {
      current = {
        key,
        ...splitDateLabel(item.dateLabel),
        items: [],
      };
      groups.push(current);
    }
    current.items.push(item);
  });
  return groups;
}

function splitDateLabel(label) {
  const cleanLabel = String(label || "Unknown date");
  const match = cleanLabel.match(/^([^,]+),\s(.+),\s(\d{4})$/);
  if (!match) {
    return {
      weekday: "",
      monthDay: cleanLabel,
      yearLabel: "",
      fullLabel: cleanLabel,
    };
  }
  return {
    weekday: match[1],
    monthDay: match[2],
    yearLabel: match[3],
    fullLabel: cleanLabel,
  };
}

function renderDateGroup(group, route) {
  return `
    <section class="timeline-day-group">
      <header class="timeline-day-header">
        <div>
          ${group.weekday ? `<p class="section-kicker">${escapeHtml(group.weekday)}</p>` : ""}
          <h3>${escapeHtml(group.monthDay)}</h3>
        </div>
        <p>${escapeHtml(String(group.items.length))} event${group.items.length === 1 ? "" : "s"}</p>
      </header>
      <div class="timeline-event-list">
        ${group.items
          .map((item) =>
            renderTimelineEventCard(item, {
              actionLabel: route.selection.eventId && normalizeKey(route.selection.eventId) === normalizeKey(item.id || item.slug || item.title)
                ? "Event open"
                : "Open event",
            })
          )
          .join("")}
      </div>
    </section>
  `;
}
