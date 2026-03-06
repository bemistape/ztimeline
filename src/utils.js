export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function excerpt(value, limit = 220) {
  const text = normalizeText(value).replace(/\s+/g, " ");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function formatCount(value, noun) {
  const count = Number(value) || 0;
  return `${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`;
}

export function formatTimestamp(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return text;
  }
  return parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

export function recordKindToView(kind) {
  if (kind === "person") {
    return "people";
  }
  if (kind === "location") {
    return "locations";
  }
  if (kind === "tag") {
    return "tags";
  }
  return "overview";
}

export function viewToRecordKind(view) {
  if (view === "people") {
    return "person";
  }
  if (view === "locations") {
    return "location";
  }
  if (view === "tags") {
    return "tag";
  }
  return "";
}

export function uniqueBy(values, keyFn) {
  const seen = new Set();
  const output = [];
  values.forEach((value) => {
    const key = keyFn(value);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(value);
  });
  return output;
}

export function compareByTitle(left, right) {
  return normalizeKey(left?.title).localeCompare(normalizeKey(right?.title));
}

export function matchesQuery(haystack, needle) {
  return normalizeKey(haystack).includes(normalizeKey(needle));
}

export function listIncludes(values, value) {
  const needle = normalizeKey(value);
  return (values || []).some((item) => normalizeKey(item) === needle);
}

export function toggleListValue(values, value) {
  const current = values || [];
  return listIncludes(current, value)
    ? current.filter((item) => normalizeKey(item) !== normalizeKey(value))
    : [...current, value];
}

export function flattenRefs(values) {
  return (values || []).map((item) => normalizeText(item?.name)).filter(Boolean);
}

export function stripRouteEmpty(filters) {
  return {
    q: normalizeText(filters?.q),
    types: (filters?.types || []).filter(Boolean),
    years: (filters?.years || []).filter(Boolean),
    locations: (filters?.locations || []).filter(Boolean),
    people: (filters?.people || []).filter(Boolean),
    tags: (filters?.tags || []).filter(Boolean),
    mediaOnly: Boolean(filters?.mediaOnly),
  };
}

export function buildEmptyState(title, copy) {
  return `
    <section class="empty-state">
      <p class="empty-state-eyebrow">No matches</p>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(copy)}</p>
    </section>
  `;
}
