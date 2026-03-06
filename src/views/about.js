import { escapeHtml, formatTimestamp } from "../utils.js";
import { renderSectionHeader } from "./components.js";

export function renderAbout({ shell, overview }) {
  const freshness = shell?.freshness?.generatedAt ? formatTimestamp(shell.freshness.generatedAt) : "";
  return `
    <section class="about-view">
      ${renderSectionHeader({
        kicker: "About",
        title: "Methodology and archive notes",
        copy: "The redesign keeps the same information scope while making the archive easier to navigate.",
      })}
      <div class="about-grid">
        <article class="about-card">
          <h2>Archive purpose</h2>
          <p>${escapeHtml(shell?.about || shell?.intro || "Independent research archive linking timeline entries, people, locations, tags, and evidence.")}</p>
        </article>
        <article class="about-card">
          <h2>Scope</h2>
          <p>${escapeHtml(`This build currently exposes ${overview?.stats?.events || 0} events, ${overview?.stats?.people || 0} people, ${overview?.stats?.locations || 0} locations, and ${overview?.stats?.tags || 0} tags from the synced source tables.`)}</p>
        </article>
        <article class="about-card">
          <h2>Refresh status</h2>
          <p>${escapeHtml(freshness ? `Latest event dataset refresh: ${freshness}.` : "Refresh metadata unavailable.")}</p>
        </article>
      </div>
      ${
        (shell?.legalBlocks || []).length
          ? `
            <section class="about-card about-card-wide">
              <h2>Notes and disclaimers</h2>
              ${(shell.legalBlocks || []).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
            </section>
          `
          : ""
      }
      <section class="about-card about-card-wide">
        <h2>Legacy access</h2>
        <p>The original single-page build is preserved unchanged for reference and comparison.</p>
        <p><a href="${escapeHtml(shell?.legacyUrl || "/index_v1.html")}">Open the legacy v1 page</a></p>
      </section>
    </section>
  `;
}
