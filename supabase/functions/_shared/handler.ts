import { preflight } from './cors.ts'
import { errorJson } from './responses.ts'
import { RateLimitError } from './helpers.ts'

/**
 * Wraps an Edge Function handler with CORS preflight handling and a safe
 * catch-all so internal errors never leak stack traces to the browser.
 */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req)
    if (pre) return pre
    try {
      return await fn(req)
    } catch (error) {
      if (error instanceof RateLimitError) {
        return errorJson(req, 'RATE_LIMITED', error.message, 429)
      }
      console.error('unhandled edge function error', error)
      return errorJson(req, 'SERVER_ERROR', 'Something went wrong on the server. Please try again.', 500)
    }
  }
}
