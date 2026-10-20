// Liveness endpoint used by the keep-alive cron and by external uptime monitors.
//
// Supabase pauses FREE projects after a week without activity. This endpoint is
// pinged twice a week by the `keep-alive` pg_cron job (see
// `supabase/migrations/20261020000005_keep_alive.sql`) so the project stays
// awake during the dormant months between championships.
//
// It deliberately does TWO things:
//   1. touches the database (a paused project's API can still respond, so a
//      purely static response would be a misleading "healthy" signal), and
//   2. returns no data of any kind.
//
// It must therefore stay public (`--no-verify-jwt`) but must never expose
// counts, table names, configuration or secrets.
import { handler } from '../_shared/handler.ts'
import { json } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'

Deno.serve(
  handler(async (req) => {
    let database = 'unreachable'

    try {
      // Cheapest possible real query. `head: true` asks for no rows, so this
      // costs the same as a ping but genuinely proves the database answered.
      const { error } = await serviceClient()
        .from('championships')
        .select('id', { count: 'exact', head: true })
      if (!error) database = 'ok'
    } catch {
      database = 'unreachable'
    }

    // A reachable API with an unreachable database must NOT report healthy —
    // that is exactly the "paused project" state we are guarding against.
    const healthy = database === 'ok'

    return json(
      req,
      {
        ok: healthy,
        database,
        time: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    )
  }),
)
