import test from "node:test";
import assert from "node:assert/strict";

import { buildSearchString, parseRoute } from "../src/router.js";

test("parseRoute infers timeline from legacy filters", () => {
  const route = parseRoute("?q=Vallejo&person=Mike+Mageau&media=1");
  assert.equal(route.view, "timeline");
  assert.equal(route.filters.q, "Vallejo");
  assert.deepEqual(route.filters.people, ["Mike Mageau"]);
  assert.equal(route.filters.mediaOnly, true);
});

test("parseRoute infers directory view from legacy record params", () => {
  const route = parseRoute("?recordKind=person&record=rec123");
  assert.equal(route.view, "people");
  assert.equal(route.selection.recordKind, "person");
  assert.equal(route.selection.recordId, "rec123");
});

test("buildSearchString preserves canonical view and filters", () => {
  const search = buildSearchString({
    view: "timeline",
    filters: {
      q: "Blue Rock",
      types: ["Canonical Zodiac Crime"],
      years: ["1969"],
      locations: [],
      people: [],
      tags: [],
      mediaOnly: true,
    },
    selection: {
      eventId: "recEvent1",
      recordKind: "",
      recordId: "",
    },
  });
  assert.equal(
    search,
    "?view=timeline&q=Blue+Rock&type=Canonical+Zodiac+Crime&year=1969&media=1&event=recEvent1"
  );
});
