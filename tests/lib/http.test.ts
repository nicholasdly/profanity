import { describe, expect, test } from "vitest";

import { mockRequest, parseRequest } from "@/lib/http";

describe("parseRequest", () => {
  test("returns ok on valid request", async () => {
    const request = mockRequest({ text: "Hello, world!" });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(true);
    expect(actual.text).toBe("Hello, world!");
    expect(actual.error).toBeNull();
  });

  test("returns ok on empty text string", async () => {
    const request = mockRequest({ text: "" });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(true);
    expect(actual.text).toBe("");
    expect(actual.error).toBeNull();
  });

  test("returns ok on whitespace text string", async () => {
    const request = mockRequest({ text: "  " });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(true);
    expect(actual.text).toBe("  ");
    expect(actual.error).toBeNull();
  });

  test("returns ok on max length text string", async () => {
    const text = "spam".repeat(2500);
    const request = mockRequest({ text });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(true);
    expect(actual.text).toBe(text);
    expect(actual.error).toBeNull();
  });

  test("returns not ok on invalid request (invalid json)", async () => {
    const request = mockRequest("foobar");
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(false);
    expect(actual.text).toBe(null);
    expect(actual.error).toMatch(/expected object/);
  });

  test("returns not ok on invalid request (missing text)", async () => {
    const request = mockRequest({ ping: "pong" });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(false);
    expect(actual.text).toBe(null);
    expect(actual.error).toMatch(/expected string/);
  });

  test("returns not ok on invalid request (wrong type)", async () => {
    const request = mockRequest({ text: 123 });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(false);
    expect(actual.text).toBe(null);
    expect(actual.error).toMatch(/expected string/);
  });

  test("returns not ok on invalid request (maximum text length exceeded)", async () => {
    const request = mockRequest({ text: "spam".repeat(2501) });
    const actual = await parseRequest(request);

    expect(actual.ok).toBe(false);
    expect(actual.text).toBe(null);
    expect(actual.error).toMatch(/expected string to have <=10000 characters/);
  });
});
