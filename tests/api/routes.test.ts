import { describe, expect, test } from "vitest";

import * as censor from "@/app/api/censor/route";
import * as check from "@/app/api/check/route";
import { CORS_HEADERS, mockRequest } from "@/lib/http";

describe("OPTIONS /api/check", () => {
  test("returns cors headers", () => {
    const response = check.OPTIONS();
    expect(response.status).toBe(204);
    expectCorsHeaders(response.headers);
  });
});

describe("POST /api/check", () => {
  test("returns true on profanity", async () => {
    const response = await check.POST(mockRequest({ text: "what the fuck" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ profane: true });
  });

  test("returns false on safe text", async () => {
    const response = await check.POST(mockRequest({ text: "Hello, world!" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ profane: false });
  });

  test("returns false on allowed text", async () => {
    const response = await check.POST(mockRequest({ text: "hi assistant" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ profane: false });
  });

  test("returns false on empty text string", async () => {
    const response = await check.POST(mockRequest({ text: "" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ profane: false });
  });

  test("returns false on whitespace text string", async () => {
    const response = await check.POST(mockRequest({ text: "  " }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ profane: false });
  });

  test("returns 400 on invalid json", async () => {
    const response = await check.POST(mockRequest("foobar"));
    expect(response.status).toBe(400);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toHaveProperty("error");
  });

  test("returns 400 when text field is missing", async () => {
    const response = await check.POST(mockRequest({ ping: "pong" }));
    expect(response.status).toBe(400);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toHaveProperty("error");
  });

  test("returns 400 when text is too long", async () => {
    const response = await check.POST(mockRequest({ text: "spam".repeat(2501) }));
    expect(response.status).toBe(400);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toHaveProperty("error");
  });
});

describe("OPTIONS /api/censor", () => {
  test("returns cors headers", () => {
    const response = censor.OPTIONS();
    expect(response.status).toBe(204);
    expectCorsHeaders(response.headers);
  });
});

describe("POST /api/censor", () => {
  test("returns censored text on profanity", async () => {
    const response = await censor.POST(mockRequest({ text: "what the fuck" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ text: "what the ****" });
  });

  test("returns unchanged text on safe text", async () => {
    const response = await censor.POST(mockRequest({ text: "Hello, world!" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ text: "Hello, world!" });
  });

  test("returns unchanged text on allowed text", async () => {
    const response = await censor.POST(mockRequest({ text: "hi assistant" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ text: "hi assistant" });
  });

  test("returns unchanged text on empty text string", async () => {
    const response = await censor.POST(mockRequest({ text: "" }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ text: "" });
  });

  test("returns unchanged text on whitespace text string", async () => {
    const response = await censor.POST(mockRequest({ text: "  " }));
    expect(response.status).toBe(200);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toEqual({ text: "  " });
  });

  test("returns 400 on invalid json", async () => {
    const response = await censor.POST(mockRequest("foobar"));
    expect(response.status).toBe(400);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toHaveProperty("error");
  });

  test("returns 400 when text field is missing", async () => {
    const response = await censor.POST(mockRequest({ ping: "pong" }));
    expect(response.status).toBe(400);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toHaveProperty("error");
  });

  test("returns 400 when text is too long", async () => {
    const response = await censor.POST(mockRequest({ text: "spam".repeat(2501) }));
    expect(response.status).toBe(400);
    expectCorsHeaders(response.headers);

    const payload = await response.json();
    expect(payload).toHaveProperty("error");
  });
});

function expectCorsHeaders(headers: Headers) {
  for (const header of Object.keys(CORS_HEADERS) as (keyof typeof CORS_HEADERS)[]) {
    expect(headers.get(header)).toBe(CORS_HEADERS[header]);
  }
}
