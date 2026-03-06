import test from "node:test";
import assert from "node:assert/strict";

import { scoreEntry, searchIndex } from "../src/search.js";

test("scoreEntry prefers exact title matches", () => {
  const score = scoreEntry(
    {
      title: "Lake Herman Road Double Murder",
      subtitle: "Canonical Zodiac Crime",
      searchText: "Lake Herman Road Double Murder canonical zodiac crime",
    },
    "lake herman road double murder",
    ["lake", "herman", "road", "double", "murder"]
  );
  assert.equal(score, 150);
});

test("searchIndex groups and limits results by kind", () => {
  const results = searchIndex(
    [
      { kind: "event", id: "1", title: "Blue Rock Springs Shooting", subtitle: "", searchText: "blue rock springs shooting" },
      { kind: "event", id: "2", title: "Blue something else", subtitle: "", searchText: "blue something else" },
      { kind: "person", id: "3", title: "Blue Meanies", subtitle: "", searchText: "blue meanies" },
      { kind: "person", id: "4", title: "Blue Person 2", subtitle: "", searchText: "blue person 2" },
      { kind: "person", id: "5", title: "Blue Person 3", subtitle: "", searchText: "blue person 3" },
      { kind: "person", id: "6", title: "Blue Person 4", subtitle: "", searchText: "blue person 4" }
    ],
    "blue",
    { limitPerKind: 3, overallLimit: 12 }
  );

  const personGroup = results.groups.find((group) => group.kind === "person");
  assert.equal(personGroup.entries.length, 3);
  assert.equal(results.flat.length >= 4, true);
});
