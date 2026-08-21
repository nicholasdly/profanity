import { describe, expect, test } from "vitest";

import { check, censor } from "@/lib/profanity";

describe("check", () => {
  test("returns false on empty string", () => {
    const actual = check("");
    expect(actual).toBe(false);
  });

  test("returns false on whitespace string", () => {
    const actual = check("  ");
    expect(actual).toBe(false);
  });

  test("returns false on safe text", () => {
    const actual = check("Hello, world!");
    expect(actual).toBe(false);
  });

  test("returns false on allowed word", () => {
    const actual = check("assistant");
    expect(actual).toBe(false);
  });

  test("return true on profanity", () => {
    const actual = check("what the fuck");
    expect(actual).toBe(true);
  });

  test("returns true on profanity (case insensitive)", () => {
    const actual = check("holy sHiT");
    expect(actual).toBe(true);
  });

  test("returns true on profanity (punctuation separated)", () => {
    const actual = check("he's an a.s.s");
    expect(actual).toBe(true);
  });

  test("returns true on profanity (repeated characters)", () => {
    const actual = check("god daaaaaaammn");
    expect(actual).toBe(true);
  });
});

describe("censor", () => {
  test("returns unchanged text on empty string", () => {
    const actual = censor("");
    expect(actual).toBe("");
  });

  test("returns unchanged text on whitespace string", () => {
    const actual = censor("  ");
    expect(actual).toBe("  ");
  });

  test("returns unchanged text on safe text", () => {
    const actual = censor("Hello, world!");
    expect(actual).toBe("Hello, world!");
  });

  test("returns unchanged text on allowed word", () => {
    const actual = censor("assistant");
    expect(actual).toBe("assistant");
  });

  test("returns censored text on profanity", () => {
    const actual = censor("what the fuck");
    expect(actual).toBe("what the ****");
  });

  test("returns censored text on profanity (case insensitive)", () => {
    const actual = censor("holy sHiT");
    expect(actual).toBe("holy ****");
  });

  test("returns censored text on profanity (punctuation separated)", () => {
    const actual = censor("he's an a.s.s");
    expect(actual).toBe("he's an *****");
  });

  test("returns censored text on profanity (repeated characters)", () => {
    const actual = censor("god daaaaaaammn");
    expect(actual).toBe("god ***********");
  });
});
