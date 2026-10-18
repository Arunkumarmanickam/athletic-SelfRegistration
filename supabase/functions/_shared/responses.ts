import { corsHeaders } from './cors.ts'

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
  })
}

export function errorJson(
  req: Request,
  code: string,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return json(req, { error: { code, message, ...extra } }, status)
}
