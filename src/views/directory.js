import { buildEmptyState, escapeHtml, normalizeKey } from "../utils.js";
import { kindHeading, renderArchiveCard, renderSectionHeader } from "./components.js";

export function renderDirectory({ view, payload, route }) {
  if (!payload) {
    return `<section class="loading-state"><p>Loading ${escapeHtml(kindHeading(view).toLowerCase())}…</p></section>`;
  }
  const items = filterItems(payload.items || [], route.filters.q);
  return `
    <section class="directory-view">
      ${renderSectionHeader({
        kicker: kindHeading(view),
        title: `Browse ${kindHeading(view).toLowerCase()}`,
        copy: view === "people"
          ? "Research records with aliases, related events, and cross-linked locations."
          : view === "locations"
            ? "Location records prioritize connected events and available map context."
            : "Tags create a thematic browse layer over the archive.",
      })}
      <section class="directory-toolbar">
        <label class="view-search">
          <span>Search ${escapeHtml(kindHeading(view).toLowerCase())}</span>
          <input
            type="search"
            data-focus-key="view-search"
            data-view-search
            value="${escapeHtml(route.filters.q)}"
            placeholder="Filter this directory"
          />
        </label>
        <p class="directory-count">${escapeHtml(String(items.length))} visible</p>
      </section>
      ${
        items.length
          ? `
            <div class="directory-grid">
              ${items.map((item) => renderArchiveCard(item, { compact: true })).join("")}
            </div>
          `
          : buildEmptyState(`No ${kindHeading(view).toLowerCase()} match this search.`, "Try a broader query or clear the search field.")
      }
    </section>
  `;
}

function filterItems(items, query) {
  const cleanQuery = normalizeKey(query);
  if (!cleanQuery) {
    return items;
  }
  return items.filter((item) => normalizeKey(item.searchText).includes(cleanQuery));
}
