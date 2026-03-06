import { renderRichText } from "../richText.js";
import {
  escapeHtml,
  excerpt,
  flattenRefs,
  formatCount,
  formatTimestamp,
  normalizeText,
  recordKindToView,
} from "../utils.js";

const VIEW_LABELS = {
  overview: "Overview",
  timeline: "Timeline",
  people: "People",
  locations: "Locations",
  tags: "Tags",
  about: "About",
};

const KIND_LABELS = {
  event: "Event",
  person: "Person",
  location: "Location",
  tag: "Tag",
};

export function renderHeader({ shell, route, searchState, searchGroups, activeResult }) {
  const title = shell?.title || "ZTimeline";
  const subtitle = shell?.subtitle || "Archive";
  const freshness = shell?.freshness?.generatedLabel
    ? `Data refreshed ${shell.freshness.generatedLabel}${shell.freshness.syncMode ? ` (${shell.freshness.syncMode})` : ""}`
    : "";

  return `
    <div class="masthead">
      <div class="masthead-brand">
        <img class="masthead-mark" src="${escapeHtml(shell?.heroMarkUrl || "assets/zodiac-header.png")}" alt="ZTimeline archive mark" />
        <div>
          <p class="masthead-eyebrow">${escapeHtml(subtitle)}</p>
          <a class="masthead-title" href="/" data-nav-view="overview">${escapeHtml(title)}</a>
          ${freshness ? `<p class="masthead-freshness">${escapeHtml(freshness)}</p>` : ""}
        </div>
      </div>
      <nav class="masthead-nav" aria-label="Primary">
        ${["overview", "timeline", "people", "locations", "tags", "about"]
          .map(
            (view) => `
              <button
                class="nav-pill ${route.view === view ? "is-active" : ""}"
                type="button"
                data-nav-view="${view}"
              >
                ${escapeHtml(VIEW_LABELS[view])}
              </button>
            `
          )
          .join("")}
      </nav>
      <div class="global-search" data-search-root>
        <label class="global-search-label" for="global-search-input">Global archive search</label>
        <input
          id="global-search-input"
          class="global-search-input"
          data-focus-key="global-search"
          data-global-search
          type="search"
          autocomplete="off"
          placeholder="Search events, people, locations, and tags"
          value="${escapeHtml(searchState.query)}"
        />
        ${renderSearchDropdown(searchGroups, searchState, activeResult)}
      </div>
    </div>
  `;
}

export function renderFooter({ shell }) {
  const about = normalizeText(shell?.about);
  const legalBlocks = shell?.legalBlocks || [];
  const footerLinks = uniqueFooterLinks(shell?.footerLinks || [], shell?.legacyUrl || "/index_v1.html");
  return `
    <div class="footer-grid">
      <section class="footer-card">
        <p class="section-kicker">Archive</p>
        <h2>Reference-first, easier to navigate.</h2>
        ${about ? `<p>${escapeHtml(about)}</p>` : "<p>Independent research archive linking events, people, locations, and tags.</p>"}
      </section>
      <section class="footer-card">
        <p class="section-kicker">Links</p>
        <div class="footer-links">
          ${footerLinks
            .map(
              (item) => `
                <a href="${escapeHtml(item.url)}"${item.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
                  ${escapeHtml(item.label)}
                </a>
              `
            )
            .join("")}
        </div>
      </section>
      <section class="footer-card">
        <p class="section-kicker">Notes</p>
        ${legalBlocks.length ? legalBlocks.map((item) => `<p>${escapeHtml(item)}</p>`).join("") : "<p>Content is preserved for research and reference use.</p>"}
      </section>
    </div>
  `;
}

function uniqueFooterLinks(links, legacyUrl) {
  const output = [];
  const seen = new Set();
  [...links, { label: "Legacy v1", url: legacyUrl, external: false }].forEach((item) => {
    const url = normalizeText(item?.url);
    const label = normalizeText(item?.label) || "Link";
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    output.push({
      label,
      url,
      external: /^https?:\/\//i.test(url),
    });
  });
  return output;
}

export function renderSearchDropdown(groups, searchState, activeResult) {
  if (!searchState.query || !searchGroupsHasEntries(groups)) {
    return "";
  }
  return `
    <div class="search-dropdown" role="listbox">
      ${groups
        .map(
          (group) => `
            <section class="search-group">
              <p class="search-group-title">${escapeHtml(KIND_LABELS[group.kind] || group.kind)}</p>
              ${group.entries
                .map((item) => {
                  const isActive =
                    activeResult && activeResult.id === item.id && activeResult.kind === item.kind;
                  return `
                    <button
                      class="search-result ${isActive ? "is-active" : ""}"
                      type="button"
                      data-search-select="${item.kind}:${item.id}"
                    >
                      <span class="search-result-title">${escapeHtml(item.title)}</span>
                      <span class="search-result-meta">${escapeHtml(item.subtitle || KIND_LABELS[item.kind] || "")}</span>
                    </button>
                  `;
                })
                .join("")}
            </section>
          `
        )
        .join("")}
    </div>
  `;
}

function searchGroupsHasEntries(groups) {
  return (groups || []).some((group) => (group.entries || []).length > 0);
}

export function renderFacetMenu({ facet, label, options, selectedValues, openFacet, query }) {
  const cleanQuery = normalizeText(query);
  const filteredOptions = (options || []).filter((option) =>
    normalizeText(option.value).toLowerCase().includes(cleanQuery.toLowerCase())
  );
  const visibleOptions = filteredOptions.slice(0, 120);
  const selectedCount = (selectedValues || []).length;
  return `
    <section class="facet-menu ${openFacet === facet ? "is-open" : ""}" data-facet="${facet}">
      <button class="facet-trigger" type="button" data-toggle-facet="${facet}">
        <span>${escapeHtml(label)}</span>
        <span class="facet-trigger-meta">${selectedCount ? escapeHtml(String(selectedCount)) : escapeHtml(String(options?.length || 0))}</span>
      </button>
      ${
        openFacet === facet
          ? `
            <div class="facet-popover">
              <input
                class="facet-search-input"
                data-focus-key="facet-${facet}"
                data-facet-search="${facet}"
                type="search"
                placeholder="Filter ${escapeHtml(label.toLowerCase())}"
                value="${escapeHtml(cleanQuery)}"
              />
              <div class="facet-options">
                ${
                  visibleOptions.length
                    ? visibleOptions
                        .map(
                          (option) => `
                            <label class="facet-option">
                              <input
                                type="checkbox"
                                data-facet-checkbox="${facet}"
                                value="${escapeHtml(option.value)}"
                                ${(selectedValues || []).includes(option.value) ? "checked" : ""}
                              />
                              <span>${escapeHtml(option.value)}</span>
                              <span class="facet-option-count">${escapeHtml(String(option.count))}</span>
                            </label>
                          `
                        )
                        .join("")
                    : '<p class="facet-empty">No facet matches.</p>'
                }
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;
}

export function renderFilterChips(filters) {
  const chips = [
    ...filters.types.map((value) => ({ facet: "types", value, label: `Type: ${value}` })),
    ...filters.years.map((value) => ({ facet: "years", value, label: `Year: ${value}` })),
    ...filters.locations.map((value) => ({ facet: "locations", value, label: `Location: ${value}` })),
    ...filters.people.map((value) => ({ facet: "people", value, label: `Person: ${value}` })),
    ...filters.tags.map((value) => ({ facet: "tags", value, label: `Tag: ${value}` })),
  ];
  if (filters.mediaOnly) {
    chips.push({ facet: "mediaOnly", value: "1", label: "Only with media" });
  }
  if (!chips.length && !filters.q) {
    return "";
  }
  return `
    <div class="filter-chip-row">
      ${filters.q ? `<button class="filter-chip is-search" type="button" data-clear-search>Search: ${escapeHtml(filters.q)}</button>` : ""}
      ${chips
        .map(
          (chip) => `
            <button
              class="filter-chip"
              type="button"
              data-remove-filter="${chip.facet}:${escapeHtml(chip.value)}"
            >
              ${escapeHtml(chip.label)}
            </button>
          `
        )
        .join("")}
      <button class="filter-chip is-clear" type="button" data-clear-filters>Clear all</button>
    </div>
  `;
}

export function renderRefButtons(refs, kind) {
  const items = refs || [];
  if (!items.length) {
    return "";
  }
  return `
    <div class="ref-pill-row">
      ${items
        .map(
          (item) => `
            <button
              class="ref-pill"
              type="button"
              data-open-record-kind="${escapeHtml(kind)}"
              data-open-record-id="${escapeHtml(item.id || item.slug || item.name)}"
            >
              ${escapeHtml(item.name)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderMediaStrip(images, options = {}) {
  const items = images || [];
  if (!items.length) {
    return "";
  }
  const preview = items.slice(0, options.limit || 8);
  return `
    <section class="media-strip">
      <div class="media-strip-grid">
        ${preview
          .map(
            (item, index) => `
              <button
                class="media-tile"
                type="button"
                data-open-media="${escapeHtml(options.contextKey || "")}"
                data-media-index="${escapeHtml(String(index))}"
              >
                <img src="${escapeHtml(item.thumbUrl || item.originalUrl)}" alt="${escapeHtml(item.label || "Archive image")}" loading="lazy" />
                <span>${escapeHtml(item.label || "Image")}</span>
              </button>
            `
          )
          .join("")}
      </div>
      ${
        items.length > preview.length
          ? `<p class="media-more">${escapeHtml(String(items.length - preview.length))} additional image${items.length - preview.length === 1 ? "" : "s"} in this set.</p>`
          : ""
      }
    </section>
  `;
}

export function renderLinks(links, title = "Links") {
  const items = links || [];
  if (!items.length) {
    return "";
  }
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="detail-link-row">
        ${items
          .map(
            (item) => `
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(item.label || item.url)}
              </a>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

export function renderFacts(facts) {
  const items = facts || [];
  if (!items.length) {
    return "";
  }
  return `
    <dl class="detail-facts">
      ${items
        .map(
          (item) => `
            <div class="detail-fact">
              <dt>${escapeHtml(item.label)}</dt>
              <dd>${escapeHtml(item.value)}</dd>
            </div>
          `
        )
        .join("")}
    </dl>
  `;
}

export function renderDetailPanel({ selection, item, shell }) {
  if (!item) {
    return "";
  }
  const isEvent = item.kind === "event";
  const relatedButton = !isEvent
    ? `
        <button
          class="panel-action"
          type="button"
          data-open-related-events="${escapeHtml(item.kind)}:${escapeHtml(item.id || item.slug || item.title)}"
        >
          View related events
        </button>
      `
    : "";
  const contextMeta = isEvent
    ? [item.type, item.dateLabel, item.timeLabel].filter(Boolean).join(" • ")
    : [KIND_LABELS[item.kind], item.subtitle].filter(Boolean).join(" • ");
  return `
    <div class="detail-panel-inner">
      <div class="detail-panel-header">
        <div>
          <p class="section-kicker">${escapeHtml(KIND_LABELS[item.kind] || "Detail")}</p>
          <h2>${escapeHtml(item.title)}</h2>
          ${contextMeta ? `<p class="detail-subtitle">${escapeHtml(contextMeta)}</p>` : ""}
        </div>
        <button class="panel-close" type="button" data-close-detail aria-label="Close detail panel">Close</button>
      </div>

      ${relatedButton}
      ${item.summary || item.description ? renderRichText(item.summary || item.description, "detail-rich-text") : ""}
      ${renderFacts(item.facts)}

      ${
        isEvent
          ? `
            ${item.locations?.length ? `<section class="detail-section"><h3>Locations</h3>${renderRefButtons(item.locations, "location")}</section>` : ""}
            ${item.people?.length ? `<section class="detail-section"><h3>People</h3>${renderRefButtons(item.people, "person")}</section>` : ""}
            ${item.tags?.length ? `<section class="detail-section"><h3>Tags</h3>${renderRefButtons(item.tags, "tag")}</section>` : ""}
            ${renderMediaStrip(item.images, { contextKey: `event:${item.id}`, limit: 12 })}
            ${renderLinks(item.sources, "Sources")}
            ${
              item.mapUrl
                ? `<section class="detail-section"><h3>Map</h3><a href="${escapeHtml(item.mapUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></section>`
                : ""
            }
          `
          : `
            ${renderMediaStrip(item.images, { contextKey: `${item.kind}:${item.id}`, limit: 12 })}
            ${item.mapEmbedUrl ? `<section class="detail-section"><h3>Map</h3><iframe class="detail-map" loading="lazy" src="${escapeHtml(item.mapEmbedUrl)}" title="Map for ${escapeHtml(item.title)}"></iframe></section>` : ""}
            ${item.relatedPeople?.length ? `<section class="detail-section"><h3>People</h3>${renderRefButtons(item.relatedPeople, "person")}</section>` : ""}
            ${item.relatedLocations?.length ? `<section class="detail-section"><h3>Locations</h3>${renderRefButtons(item.relatedLocations, "location")}</section>` : ""}
            ${item.relatedTags?.length ? `<section class="detail-section"><h3>Tags</h3>${renderRefButtons(item.relatedTags, "tag")}</section>` : ""}
            ${
              item.relatedEvents?.length
                ? `
                  <section class="detail-section">
                    <h3>${escapeHtml(formatCount(item.relatedEvents.length, "related event"))}</h3>
                    <div class="ref-pill-row">
                      ${item.relatedEvents
                        .slice(0, 40)
                        .map(
                          (event) => `
                            <button
                              class="ref-pill"
                              type="button"
                              data-open-event="${escapeHtml(event.id || event.slug || event.name)}"
                            >
                              ${escapeHtml(event.name)}
                            </button>
                          `
                        )
                        .join("")}
                    </div>
                  </section>
                `
                : ""
            }
            ${renderLinks(item.downloads, "Links")}
          `
      }

      <section class="detail-section detail-legacy-link">
        <a href="${escapeHtml(shell?.legacyUrl || "/index_v1.html")}">Open preserved legacy v1</a>
      </section>
    </div>
  `;
}

export function renderMediaDialog(mediaState) {
  if (!mediaState?.open || !mediaState.current) {
    return "";
  }
  const item = mediaState.current;
  return `
    <article class="media-dialog-body">
      <div class="media-dialog-header">
        <div>
          <p class="section-kicker">Media viewer</p>
          <h2>${escapeHtml(item.label || "Archive image")}</h2>
          ${
            mediaState.total > 1
              ? `<p class="media-dialog-meta">${escapeHtml(String(mediaState.index + 1))} of ${escapeHtml(String(mediaState.total))}</p>`
              : ""
          }
        </div>
        <div class="media-dialog-actions">
          <a href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener noreferrer">Open original</a>
          <button type="button" data-close-media>Close</button>
        </div>
      </div>
      <figure class="media-dialog-figure">
        <img src="${escapeHtml(item.originalUrl)}" alt="${escapeHtml(item.label || "Archive image")}" />
      </figure>
      ${
        mediaState.total > 1
          ? `
            <div class="media-dialog-nav">
              <button type="button" data-shift-media="-1">Previous</button>
              <button type="button" data-shift-media="1">Next</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

export function renderSectionList(items, kind) {
  return `
    <div class="overview-mini-list">
      ${items
        .map(
          (item) => `
            <button
              class="overview-mini-item"
              type="button"
              data-open-record-kind="${escapeHtml(kind)}"
              data-open-record-id="${escapeHtml(item.id || item.slug || item.title)}"
            >
              <span>${escapeHtml(item.title)}</span>
              ${
                item.relatedEventCount
                  ? `<span class="overview-mini-meta">${escapeHtml(String(item.relatedEventCount))}</span>`
                  : ""
              }
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderSectionCard({ kicker, title, copy, actionView, actionLabel }) {
  return `
    <article class="section-card">
      <p class="section-kicker">${escapeHtml(kicker)}</p>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(copy)}</p>
      ${
        actionView
          ? `<button class="section-card-action" type="button" data-nav-view="${escapeHtml(actionView)}">${escapeHtml(actionLabel || `Open ${title}`)}</button>`
          : ""
      }
    </article>
  `;
}

export function renderSectionHeader({ kicker, title, copy }) {
  return `
    <header class="view-header">
      <p class="section-kicker">${escapeHtml(kicker)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(copy)}</p>
    </header>
  `;
}

export function renderCardMetrics(metrics) {
  return `
    <div class="card-metrics">
      ${metrics
        .filter((item) => item.value)
        .map(
          (item) => `
            <div class="card-metric">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

export function renderMetaPills(values) {
  if (!(values || []).length) {
    return "";
  }
  return `
    <div class="meta-pill-row">
      ${values.map((value) => `<span class="meta-pill">${escapeHtml(value)}</span>`).join("")}
    </div>
  `;
}

export function renderArchiveCard(item, options = {}) {
  const image = item.primaryImage || (item.images || [])[0];
  const subtitle = item.subtitle || item.type || item.dateLabel || "";
  const actionKind = item.kind === "event" ? "event" : "record";
  const actionAttrs =
    actionKind === "event"
      ? `data-open-event="${escapeHtml(item.id || item.slug || item.title)}"`
      : `data-open-record-kind="${escapeHtml(item.kind)}" data-open-record-id="${escapeHtml(item.id || item.slug || item.title)}"`;
  const copy = item.excerpt || excerpt(item.summary || item.description || "", options.copyLimit || 160);
  const metaPills = item.kind === "event"
    ? [item.type, item.dateLabel, item.timeLabel].filter(Boolean)
    : [item.subtitle, item.relatedEventCount ? formatCount(item.relatedEventCount, "event") : ""].filter(Boolean);
  return `
    <article class="archive-card ${options.compact ? "is-compact" : ""} ${item.kind === "event" ? "is-event" : ""}">
      ${
        image
          ? `<img class="archive-card-image" src="${escapeHtml(image.thumbUrl || image.originalUrl)}" alt="${escapeHtml(image.label || item.title)}" loading="lazy" />`
          : `<div class="archive-card-image is-placeholder">${escapeHtml((item.title || "").slice(0, 1) || "·")}</div>`
      }
      <div class="archive-card-body">
        <p class="archive-card-kicker">${escapeHtml(KIND_LABELS[item.kind] || "Record")}</p>
        <h3>${escapeHtml(item.title)}</h3>
        ${subtitle ? `<p class="archive-card-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        ${copy ? `<p class="archive-card-copy">${escapeHtml(copy)}</p>` : ""}
        ${renderMetaPills(metaPills)}
        ${
          item.kind === "event"
            ? renderCardMetrics([
                { label: "People", value: flattenRefs(item.people).length ? String(flattenRefs(item.people).length) : "" },
                { label: "Media", value: item.images?.length ? String(item.images.length) : "" },
                { label: "Sources", value: item.sources?.length ? String(item.sources.length) : "" },
              ])
            : ""
        }
        <button class="archive-card-action" type="button" ${actionAttrs}>
          ${options.actionLabel || (item.kind === "event" ? "Open event" : `Open ${KIND_LABELS[item.kind] || "record"}`)}
        </button>
      </div>
    </article>
  `;
}

export function kindHeading(view) {
  return VIEW_LABELS[view] || "Archive";
}

export function relatedEventsHeadline(item) {
  return item.relatedEventCount ? formatCount(item.relatedEventCount, "linked event") : "No linked events";
}
