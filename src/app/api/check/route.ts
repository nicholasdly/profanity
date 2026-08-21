import { CORS_HEADERS, parseRequest } from "@/lib/http";
import { check } from "@/lib/profanity";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const { ok, text, error } = await parseRequest(request);
  if (text?.trim() === "") {
    return Response.json({ profane: false }, { headers: CORS_HEADERS });
  }

  return ok
    ? Response.json({ profane: check(text) }, { headers: CORS_HEADERS })
    : Response.json({ error }, { status: 400, headers: CORS_HEADERS });
}
