import { escapeHtml, normalizeText } from "./utils.js";

export function renderRichText(input, className = "rich-text") {
  const text = normalizeText(input);
  if (!text) {
    return "";
  }

  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n+/);
  const html = blocks
    .map((block) => renderBlock(block))
    .filter(Boolean)
    .join("");

  return `<div class="${className}">${html}</div>`;
}

function renderBlock(block) {
  const lines = block.split("\n").map((line) => line.trimEnd());
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (!nonEmpty.length) {
    return "";
  }

  const headingMatch = nonEmpty.length === 1 ? nonEmpty[0].match(/^(#{1,6})\s+(.+)$/) : null;
  if (headingMatch) {
    const level = Math.min(4, headingMatch[1].length + 1);
    return `<h${level}>${renderInline(headingMatch[2])}</h${level}>`;
  }

  const listMatches = nonEmpty.map((line) => line.match(/^\s*[-*]\s+(.+)$/)).filter(Boolean);
  if (listMatches.length === nonEmpty.length) {
    return `<ul>${listMatches.map((match) => `<li>${renderInline(match[1])}</li>`).join("")}</ul>`;
  }

  const quoteMatches = nonEmpty.map((line) => line.match(/^\s*>\s?(.*)$/)).filter(Boolean);
  if (quoteMatches.length === nonEmpty.length) {
    return `<blockquote>${quoteMatches.map((match) => `<p>${renderInline(match[1])}</p>`).join("")}</blockquote>`;
  }

  return `<p>${lines.map((line) => renderInline(line)).join("<br />")}</p>`;
}

function renderInline(text) {
  const tokenPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s]+)/gi;
  let cursor = 0;
  let output = "";
  let match = tokenPattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      output += renderEmphasis(text.slice(cursor, match.index));
    }
    const label = match[1];
    const url = match[2] || match[3];
    const safeLabel = label ? renderEmphasis(label) : escapeHtml(stripTrailingUrlPunctuation(url));
    output += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
    cursor = tokenPattern.lastIndex;
    match = tokenPattern.exec(text);
  }

  if (cursor < text.length) {
    output += renderEmphasis(text.slice(cursor));
  }

  return output;
}

function renderEmphasis(text) {
  let output = "";
  let cursor = 0;
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|~~(.+?)~~/g;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > cursor) {
      output += escapeHtml(text.slice(cursor, match.index));
    }
    if (match[1]) {
      output += `<strong>${escapeHtml(match[2])}</strong>`;
    } else if (match[3]) {
      output += `<em>${escapeHtml(match[4])}</em>`;
    } else if (match[5]) {
      output += `<s>${escapeHtml(match[5])}</s>`;
    }
    cursor = pattern.lastIndex;
    match = pattern.exec(text);
  }
  if (cursor < text.length) {
    output += escapeHtml(text.slice(cursor));
  }
  return output;
}

function stripTrailingUrlPunctuation(url) {
  return String(url || "").replace(/[),.;!?]+$/g, "");
}
