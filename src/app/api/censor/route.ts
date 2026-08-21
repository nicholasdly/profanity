import { CORS_HEADERS, parseRequest } from "@/lib/http";
import { censor } from "@/lib/profanity";

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const { ok, text, error } = await parseRequest(request);
  if (text?.trim() === "") {
    return Response.json({ text }, { headers: CORS_HEADERS });
  }

  return ok
    ? Response.json({ text: censor(text) }, { headers: CORS_HEADERS })
    : Response.json({ error }, { status: 400, headers: CORS_HEADERS });
}
