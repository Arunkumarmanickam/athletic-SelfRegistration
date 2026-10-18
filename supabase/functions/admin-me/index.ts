// Returns the signed-in administrator's profile (used by the dashboard to
// verify access and show the user's role).
import { handler } from '../_shared/handler.ts'
import { json } from '../_shared/responses.ts'
import { requireAdmin } from '../_shared/admin-auth.ts'

Deno.serve(
  handler(async (req) => {
    const context = await requireAdmin(req)
    if (context instanceof Response) return context
    return json(req, { admin: context.admin })
  }),
)
