// Exchanges a single-use receipt token for the confirmation payload.
//
// Used after a redirect-based payment (net banking / bank UPI apps): Razorpay
// POSTs to `payment-callback`, which verifies the payment and redirects the
// browser to /registration/success?receipt=<token>. The site calls this once to
// fetch the receipt. The token is consumed on first use, so a copied URL cannot
// be replayed, and it expires quickly.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, readJson, str } from '../_shared/helpers.ts'
import { loadConfirmation } from '../_shared/payments.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const token = str(body.token)

    const supabase = serviceClient()
    await enforceRateLimit(supabase, `receipt-token:${clientIp(req)}`, 60, 3600)

    if (!token) return errorJson(req, 'MISSING_FIELDS', 'A receipt token is required.', 400)

    const { data: hash, error: hashError } = await supabase.rpc('hash_secret', { p_value: token })
    if (hashError || !hash) {
      return errorJson(req, 'SERVER_ERROR', 'Could not read the receipt. Please look up your registration.', 500)
    }

    const { data: row } = await supabase
      .from('receipt_tokens')
      .select('id, registration_id, expires_at, consumed_at')
      .eq('token_hash', hash as string)
      .maybeSingle()

    // One message for missing / expired / already used: nothing to learn by
    // distinguishing them, and the athlete is always sent to the status lookup.
    if (!row || row.consumed_at || new Date(row.expires_at as string) < new Date()) {
      return errorJson(
        req,
        'RECEIPT_EXPIRED',
        'This receipt link has expired. You can look up your registration with your Registration ID and mobile number.',
        410,
      )
    }

    // Consume first, so two simultaneous requests cannot both succeed.
    const { data: consumed } = await supabase
      .from('receipt_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
      .select('id')

    if (!consumed || consumed.length === 0) {
      return errorJson(
        req,
        'RECEIPT_EXPIRED',
        'This receipt link has already been used. You can look up your registration with your Registration ID and mobile number.',
        410,
      )
    }

    const confirmation = await loadConfirmation(supabase, row.registration_id as string)
    if (!confirmation) {
      return errorJson(req, 'NOT_FOUND', 'We could not find that registration.', 404)
    }

    return json(req, { ok: true, confirmation })
  }),
)
