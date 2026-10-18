// Shared CORS handling for all Edge Functions.
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:3000']

function allowedOrigins(): string[] {
  const env = Deno.env.get('ALLOWED_ORIGINS')
  if (!env) return DEFAULT_ORIGINS
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isLocalhostOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') ?? ''
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allow = allowedOrigins().includes(origin) ? origin : (allowedOrigins()[0] ?? '')
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }
  return null
}
