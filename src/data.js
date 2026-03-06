const PATHS = {
  shell: "data/site-shell.json",
  overview: "data/overview.json",
  search: "data/search-index.json",
  events: "data/events.json",
  people: "data/people.json",
  locations: "data/locations.json",
  tags: "data/tags.json",
};

const cache = new Map();

export async function loadShellBundle() {
  const [shell, overview, searchIndex] = await Promise.all([
    fetchJson(PATHS.shell),
    fetchJson(PATHS.overview),
    fetchJson(PATHS.search),
  ]);
  return {
    shell,
    overview,
    searchIndex: searchIndex?.items || [],
  };
}

export async function loadEvents() {
  const payload = await fetchJson(PATHS.events);
  return payload || { items: [], facets: {} };
}

export async function loadPeople() {
  const payload = await fetchJson(PATHS.people);
  return payload || { items: [] };
}

export async function loadLocations() {
  const payload = await fetchJson(PATHS.locations);
  return payload || { items: [] };
}

export async function loadTags() {
  const payload = await fetchJson(PATHS.tags);
  return payload || { items: [] };
}

async function fetchJson(path) {
  if (cache.has(path)) {
    return cache.get(path);
  }
  const promise = fetch(path, { cache: "no-cache" }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load ${path}`);
    }
    return response.json();
  });
  cache.set(path, promise);
  return promise;
}
