import { normalizeKey } from "./utils.js";

const KIND_ORDER = {
  event: 0,
  person: 1,
  location: 2,
  tag: 3,
};

export function searchIndex(items, query, options = {}) {
  const cleanQuery = normalizeKey(query);
  if (!cleanQuery) {
    return { groups: [], flat: [] };
  }
  const limitPerKind = options.limitPerKind ?? 4;
  const overallLimit = options.overallLimit ?? 12;
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  const scored = (items || [])
    .map((item) => ({ item, score: scoreEntry(item, cleanQuery, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftKind = KIND_ORDER[left.item.kind] ?? 99;
      const rightKind = KIND_ORDER[right.item.kind] ?? 99;
      if (leftKind !== rightKind) {
        return leftKind - rightKind;
      }
      return normalizeKey(left.item.title).localeCompare(normalizeKey(right.item.title));
    });

  const buckets = new Map();
  scored.forEach(({ item, score }) => {
    const bucket = buckets.get(item.kind) || [];
    if (bucket.length < limitPerKind) {
      bucket.push({ ...item, score });
      buckets.set(item.kind, bucket);
    }
  });

  const groups = [...buckets.entries()]
    .sort((left, right) => (KIND_ORDER[left[0]] ?? 99) - (KIND_ORDER[right[0]] ?? 99))
    .map(([kind, entries]) => ({ kind, entries }));

  const flat = groups.flatMap((group) => group.entries).slice(0, overallLimit);
  return { groups, flat };
}

export function scoreEntry(entry, cleanQuery, tokens) {
  const title = normalizeKey(entry?.title);
  const subtitle = normalizeKey(entry?.subtitle);
  const searchText = normalizeKey(entry?.searchText);
  if (!searchText) {
    return 0;
  }
  if (title === cleanQuery) {
    return 150;
  }
  if (title.startsWith(cleanQuery)) {
    return 125;
  }
  if (title.includes(cleanQuery)) {
    return 110;
  }
  if (subtitle.includes(cleanQuery)) {
    return 85;
  }
  if (tokens.every((token) => title.includes(token))) {
    return 80;
  }
  if (tokens.every((token) => searchText.includes(token))) {
    return 65;
  }
  if (searchText.includes(cleanQuery)) {
    return 50;
  }
  return 0;
}
