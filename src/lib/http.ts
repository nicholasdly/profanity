import * as z from "zod";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function parseRequest(request: Request) {
  try {
    const json = await request.json();
    const parsed = z.object({ text: z.string().max(10_000) }).safeParse(json);

    return parsed.success
      ? { ok: true as const, text: parsed.data.text, error: null }
      : { ok: false as const, text: null, error: z.prettifyError(parsed.error) };
  } catch {
    return { ok: false as const, text: null, error: "invalid json" };
  }
}

export function mockRequest(body: any) {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
