import { renderArchiveCard, renderSectionCard, renderSectionHeader, renderSectionList } from "./components.js";
import { escapeHtml } from "../utils.js";

export function renderOverview({ shell, overview }) {
  if (!overview) {
    return `<section class="loading-state"><p>Loading archive overview…</p></section>`;
  }
  const stats = overview.stats || {};
  const featuredPeople = overview.featuredPeople || [];
  const featuredLocations = overview.featuredLocations || [];
  const featuredTags = overview.featuredTags || [];
  return `
    <section class="overview-view">
      <section class="hero-card">
        <div class="hero-copy">
          <p class="section-kicker">${escapeHtml(shell?.subtitle || "Archive")}</p>
          <h1>${escapeHtml(shell?.title || "ZTimeline")}</h1>
          <p>${escapeHtml(shell?.intro || "Independent research archive organizing events, people, locations, and source evidence.")}</p>
          <div class="hero-actions">
            <button class="hero-action is-primary" type="button" data-nav-view="timeline">Enter the timeline</button>
            <button class="hero-action" type="button" data-nav-view="people">Browse people</button>
            <button class="hero-action" type="button" data-nav-view="about">Methodology</button>
          </div>
        </div>
        <div class="hero-stats">
          ${renderStat("Events", stats.events)}
          ${renderStat("People", stats.people)}
          ${renderStat("Locations", stats.locations)}
          ${renderStat("Tags", stats.tags)}
          ${renderStat("Images", stats.images)}
          ${renderStat("Span", stats.years?.start && stats.years?.end ? `${stats.years.start}–${stats.years.end}` : "n/a")}
        </div>
      </section>

      <section class="overview-grid">
        ${overview.entryPoints
          .map((entry) =>
            renderSectionCard({
              kicker: "Start here",
              title: entry.title,
              copy: entry.description,
              actionView: entry.view,
              actionLabel: `Open ${entry.title}`,
            })
          )
          .join("")}
      </section>

      <section class="overview-split">
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Most active years",
            title: "Where the archive is densest",
            copy: "Jump into the years with the most linked activity.",
          })}
          <div class="overview-year-row">
            ${(overview.featuredYears || [])
              .map(
                (item) => `
                  <button class="overview-year-pill" type="button" data-jump-year="${escapeHtml(String(item.value))}">
                    <strong>${escapeHtml(String(item.value))}</strong>
                    <span>${escapeHtml(String(item.count))}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </article>
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Event types",
            title: "Common archive lenses",
            copy: "Use these as fast paths into the timeline.",
          })}
          <div class="overview-type-row">
            ${(overview.featuredTypes || [])
              .map(
                (item) => `
                  <button class="meta-pill is-button" type="button" data-apply-type="${escapeHtml(item.value)}">
                    ${escapeHtml(item.value)}
                    <span>${escapeHtml(String(item.count))}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </article>
      </section>

      <section class="overview-showcase">
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "People",
            title: "Most connected records",
            copy: "Open the people that tie into the greatest number of linked events.",
          })}
          <div class="overview-card-grid">
            ${featuredPeople.slice(0, 3).map((item) => renderArchiveCard(item, { compact: true, actionLabel: "Open person" })).join("")}
          </div>
        </article>
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Locations",
            title: "Places worth opening first",
            copy: "Locations are presented as browse-first records, even when notes are sparse.",
          })}
          ${renderSectionList(featuredLocations.slice(0, 8), "location")}
        </article>
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Tags",
            title: "Thematic browse layer",
            copy: "Tags connect events, records, and source clusters without losing the underlying detail.",
          })}
          ${renderSectionList(featuredTags.slice(0, 8), "tag")}
        </article>
      </section>
    </section>
  `;
}

function renderStat(label, value) {
  return `
    <article class="hero-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value == null ? "n/a" : String(value))}</strong>
    </article>
  `;
}
