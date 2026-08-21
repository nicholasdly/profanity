import { describe, expect, test, beforeEach } from "vitest";

import { type Match, Trie } from "@/lib/trie";

let trie: Trie;

beforeEach(() => {
  trie = new Trie(["he", "her", "hers", "she", "ushers"]);
});

describe("search", () => {
  test("returns all matching patterns #1", () => {
    const text = "he";
    const matches = trie.search(text);
    expect(matches).toHaveLength(1);

    const results = parseMatches(text, matches);
    expect(results).toContain("he");
  });

  test("returns all matching patterns #2", () => {
    const text = "her";
    const matches = trie.search(text);
    expect(matches).toHaveLength(2);

    const results = parseMatches(text, matches);
    expect(results).toContain("he");
    expect(results).toContain("her");
  });

  test("returns all matching patterns #3", () => {
    const text = "hers";
    const matches = trie.search(text);
    expect(matches).toHaveLength(3);

    const results = parseMatches(text, matches);
    expect(results).toContain("he");
    expect(results).toContain("her");
    expect(results).toContain("hers");
  });

  test("returns all matching patterns #4", () => {
    const text = "she";
    const matches = trie.search(text);
    expect(matches).toHaveLength(2);

    const results = parseMatches(text, matches);
    expect(results).toContain("she");
    expect(results).toContain("he");
  });

  test("returns all matching patterns #5", () => {
    const text = "ushers";
    const matches = trie.search(text);
    expect(matches).toHaveLength(5);

    const results = parseMatches(text, matches);
    expect(results).toContain("she");
    expect(results).toContain("he");
    expect(results).toContain("her");
    expect(results).toContain("ushers");
    expect(results).toContain("hers");
  });

  test("returns all matching patterns #6", () => {
    const result = trie.search("test");
    expect(result).toHaveLength(0);
  });
});

function parseMatches(text: string, matches: Match[]) {
  return matches.map(({ start, end }) => text.substring(start, end));
}
