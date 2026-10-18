// One-time creation of the FIRST (owner) administrator.
//
// Requires BOOTSTRAP_ADMIN_SECRET, which you set as an Edge Function secret,
// and can only succeed while no active owner exists. Once the owner is
// created, further administrators are created from inside the dashboard.
import { handler } from '../_shared/handler.ts'
import { json, errorJson } from '../_shared/responses.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { clientIp, enforceRateLimit, isEmail, randomPassword, readJson, str } from '../_shared/helpers.ts'
import { safeEqual } from '../_shared/razorpay.ts'
import { writeAudit } from '../_shared/admin-auth.ts'

Deno.serve(
  handler(async (req) => {
    const body = await readJson(req)
    const secret = str(body.secret)
    const email = str(body.email).toLowerCase()
    const fullName = str(body.fullName)
    let password = str(body.password)

    const supabase = serviceClient()
    await enforceRateLimit(supabase, `admin-bootstrap:${clientIp(req)}`, 10, 3600)

    const expected = Deno.env.get('BOOTSTRAP_ADMIN_SECRET') ?? ''
    if (!expected || !secret || !safeEqual(secret, expected)) {
      return errorJson(req, 'INVALID_SECRET', 'The bootstrap secret is missing or incorrect.', 403)
    }
    if (!isEmail(email)) {
      return errorJson(req, 'INVALID_EMAIL', 'Please enter a valid email address.', 400)
    }
    if (password && password.length < 12) {
      return errorJson(req, 'INVALID_PASSWORD', 'The password must be at least 12 characters long.', 400)
    }
    if (!password) password = randomPassword(16)

    const { data: owners } = await supabase
      .from('admin_users')
      .select('id')
      .eq('role', 'owner')
      .eq('is_active', true)
      .limit(1)
    if (owners && owners.length > 0) {
      return errorJson(
        req,
        'ALREADY_BOOTSTRAPPED',
        'An owner administrator already exists. Sign in and create accounts from the admin dashboard.',
        409,
      )
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created.user) {
      console.error('auth user creation failed', createError)
      return errorJson(req, 'CREATE_FAILED', createError?.message ?? 'Could not create the account.', 400)
    }

    const { error: insertError } = await supabase.from('admin_users').insert({
      id: created.user.id,
      email,
      full_name: fullName || null,
      role: 'owner',
      is_active: true,
    })
    if (insertError) {
      console.error('admin_users insert failed', insertError)
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {})
      return errorJson(req, 'SERVER_ERROR', 'Could not register the administrator account.', 500)
    }

    await writeAudit(supabase, null, 'admin.bootstrap', 'admin_user', created.user.id, { email })

    return json(req, {
      ok: true,
      email,
      temp_password: password,
      message:
        'The owner administrator has been created. Sign in with the email and password shown here. The password is displayed only once — store it securely, then you may delete the BOOTSTRAP_ADMIN_SECRET.',
    })
  }),
)
