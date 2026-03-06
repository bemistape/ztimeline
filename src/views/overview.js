import { renderSectionCard, renderSectionHeader, renderSectionList } from "./components.js";
import { escapeHtml } from "../utils.js";

export function renderOverview({ shell, overview }) {
  if (!overview) {
    return `<section class="loading-state"><p>Loading archive overview…</p></section>`;
  }
  const stats = overview.stats || {};
  const featuredPeople = overview.featuredPeople || [];
  const featuredLocations = overview.featuredLocations || [];
  const featuredTags = overview.featuredTags || [];
  const mappedLocations = overview.mappedLocations || [];
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
          ${renderStat("Mapped Sites", stats.mappedSites)}
          ${renderStat("Span", stats.years?.start && stats.years?.end ? `${stats.years.start}–${stats.years.end}` : "n/a")}
        </div>
      </section>

      <section class="overview-compass">
        <article class="overview-panel overview-panel-wide">
          ${renderSectionHeader({
            kicker: "Quick ways in",
            title: "Start with chronology, then branch out",
            copy: "Use years and event types to enter the archive quickly, then move into the supporting directories when you need more context.",
            level: 2,
          })}
          <div class="overview-action-grid">
            ${overview.entryPoints
              .map((entry) =>
                renderSectionCard({
                  kicker: entry.view === "timeline" ? "Chronology" : "Directory",
                  title: entry.title,
                  copy: entry.description,
                  actionView: entry.view,
                  actionLabel: `Open ${entry.title}`,
                })
              )
              .join("")}
          </div>
          <div class="overview-quick-grid">
            <div class="overview-quick-block">
              <p class="section-kicker">Most active years</p>
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
            </div>
            <div class="overview-quick-block">
              <p class="section-kicker">Common event types</p>
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
            </div>
          </div>
        </article>
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Mapped sites",
            title: "Locations you can open spatially",
            copy: "These records have direct map links and work well as geographic anchors when you want to move out of the chronology.",
            level: 2,
          })}
          ${mappedLocations.length
            ? renderSectionList(mappedLocations.slice(0, 8), "location", { showMapLinks: true })
            : "<p>No map-enabled locations are available in this build.</p>"}
          <div class="overview-panel-action">
            <button class="section-card-action" type="button" data-nav-view="locations">Browse all locations</button>
          </div>
        </article>
      </section>

      <section class="overview-grid overview-grid-wide">
        ${renderSectionCard({
          kicker: "People",
          title: "Connected records",
          copy: "Open the people and organizations that tie into the largest set of related events.",
          actionView: "people",
          actionLabel: "Browse people",
        })}
        ${renderSectionCard({
          kicker: "Locations",
          title: "Places and scenes",
          copy: "Locations now keep map access visible and group the related people, events, and notes around each place.",
          actionView: "locations",
          actionLabel: "Browse locations",
        })}
        ${renderSectionCard({
          kicker: "Tags",
          title: "Themes and clusters",
          copy: "Tags work best as a browse layer over evidence, crimes, suspects, communications, and recurring motifs.",
          actionView: "tags",
          actionLabel: "Browse tags",
        })}
      </section>

      <section class="overview-directory-grid">
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "People",
            title: "Most connected first",
            copy: "These records link into the broadest set of events.",
            level: 2,
          })}
          ${renderSectionList(featuredPeople.slice(0, 6), "person")}
        </article>
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Locations",
            title: "Most connected places",
            copy: "Place records with the highest event density rise to the top.",
            level: 2,
          })}
          ${renderSectionList(featuredLocations.slice(0, 6), "location", { showMapLinks: true })}
        </article>
        <article class="overview-panel">
          ${renderSectionHeader({
            kicker: "Tags",
            title: "High-signal thematic tags",
            copy: "These tag records provide strong entry points into clusters of events and documents.",
            level: 2,
          })}
          ${renderSectionList(featuredTags.slice(0, 6), "tag")}
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
