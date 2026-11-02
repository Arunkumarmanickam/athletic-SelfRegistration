# TODO — Athlete Registration Portal

Everything below is **deliberately not configured yet**. The app behaves
honestly in the meantime: it reports `payments_configured: false` instead of
pretending it works. (OTP/SMS has been removed from the product entirely —
returning athletes verify with their Athlete ID + date of birth, no SMS
involved.)

---

## 🔴 1. PhonePe payments (Standard Checkout)

**Status:** live. The association's **production** credentials are set in
Supabase, `PHONEPE_ENV=production`, and `public-config` reports
`payments_configured: true`. Verified end to end with a real unpaid order:
OAuth token issued, order created (redirect host `mercury-t2.phonepe.com`),
and Order Status API returned `PENDING` — no money charged.

Remaining: one real ₹600 checkout, and the optional webhook (1c).

### 1a. Get credentials
1. Sign in to the PhonePe Business dashboard for the association's merchant
   account.
2. Open **Developer settings** (or **Payment Gateway → API keys**).
3. Copy the **Client ID**, **Client Secret** and **Client Version**.
4. Sandbox credentials are separate from live ones. Use the sandbox set first.

### 1b. Set them as Supabase secrets
```bash
supabase link --project-ref urlkpbvvtossdzsjcmie

supabase secrets set \
  PHONEPE_CLIENT_ID=<client id> \
  PHONEPE_CLIENT_SECRET=<client secret> \
  PHONEPE_CLIENT_VERSION=<client version> \
  PHONEPE_ENV=production
```

`PHONEPE_ENV` is **not a credential** — it is a switch that tells the server
which PhonePe servers to call:

| `PHONEPE_ENV` | OAuth token URL | Payment / status API |
| --- | --- | --- |
| `sandbox` (default) | `api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token` | `api-preprod.phonepe.com/apis/pg-sandbox` |
| `production` | `api.phonepe.com/apis/identity-manager/v1/oauth/token` | `api.phonepe.com/apis/pg` |

If it does not match the credentials, every payment fails at the OAuth step
with `401`. The association's keys are production keys, so it must stay
`production`.

Never commit these values, paste them into chat, or put them in Vercel frontend
variables. They are server-side only.

### 1c. Add the webhook (recommended)
**PhonePe dashboard → Webhooks → Add webhook**
- URL: `https://urlkpbvvtossdzsjcmie.supabase.co/functions/v1/payment-webhook`
- Auth: **SHA256** with a username and password you choose
- Events: `checkout.order.completed`, `checkout.order.failed`,
  `pg.refund.completed`, `pg.refund.failed`

```bash
supabase secrets set \
  PHONEPE_WEBHOOK_USERNAME=<chosen username> \
  PHONEPE_WEBHOOK_PASSWORD=<long random password>
```

The webhook is optional: the browser callback already verifies every payment.
It only adds recovery when the athlete closes the tab before returning.

### 1d. Deploy the payment functions
```bash
supabase functions deploy payment-retry
supabase functions deploy payment-callback
supabase functions deploy verify-payment
supabase functions deploy payment-webhook
supabase functions deploy register
supabase functions deploy public-config
```

### 1e. Verify
- Reload `/admin` → Overview should show payments as configured.
- The public home page should stop showing the "payments not configured" notice.
- Run a sandbox payment and confirm:
  - PhonePe's hosted page opens (UPI / card / net banking as enabled),
  - the browser returns to `/registration/success` with a receipt,
  - the registration gets an Athlete ID and bib,
  - **Payments** in the admin shows a captured row with a PhonePe
    transaction ID.

### 1f. Going live (real money)
1. [x] Complete PhonePe **merchant/account approval**.
2. [x] Set the **production** Client ID/Secret/Version.
3. [x] Set `PHONEPE_ENV=production`.
4. [ ] Update the webhook username/password for live events (see 1c).
5. [ ] Re-test with a real (small) payment.

> ⚠️ **Live payments will not work until approval is complete and production
> credentials are configured.** Do not accept real money before that.

---

## 🟡 3. Email confirmations (optional)

Resend-based receipts are off (`RESEND_API_KEY` unset).

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx \
  NOTIFICATION_FROM_EMAIL="Registrations <registrations@yourdomain.com>"
```

---

## 🔴 4. Before production (security checklist)

- [x] **`ALLOWED_ORIGINS`** — set to
      `https://www.cdmaa.in,https://cdmaa.in,http://localhost:5173`
      (CORS blocks every other origin). Re-run this whenever the domain
      changes:
      `supabase secrets set ALLOWED_ORIGINS=https://www.cdmaa.in,https://cdmaa.in,http://localhost:5173`
- [ ] Set `VITE_SITE_URL` to the real domain in Vercel (`https://www.cdmaa.in`).
- [ ] Re-run the **test checklist** in `README.md`.
- [ ] Review the privacy / terms / retention copy with your organisation.
- [ ] **PhonePe production credentials** — done ✅ (item 1); one real ₹600
      checkout still recommended before entries open.
- [ ] Move the repo **private** if the source should not be public.

---

## 🟢 5. Deploy

- [x] Push to GitHub — `https://github.com/Arunkumarmanickam/athletic-SelfRegistration`
- [x] Import into Vercel, build `npm run build`, output `dist`
- [x] Domain connected — `https://www.cdmaa.in` (apex `cdmaa.in` redirects to www)
- [x] Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` in
      Vercel → **Settings → Environment Variables**, scoped to **Production**,
      then redeploy. The values are baked into the bundle at build time, so a
      deployment built before the variables existed keeps reporting
      "The backend is not configured yet" no matter how often the page is
      reloaded. Setting a variable is not enough — a **new build** is required.
      **Done** ✅ (verified live: bundle contains the Supabase URL/anon key)
- [x] Add the Vercel domain to `ALLOWED_ORIGINS` and redeploy functions
      (secrets take effect immediately, no function redeploy needed)

---

## 🟢 6. Credentials to delete

- [ ] Supabase CLI token (`sbp_…`) — delete at
      <https://supabase.com/dashboard/account/tokens> — PhonePe secrets are now
      set, so this is safe to do
- [ ] GitHub tokens (`ghp_…` / `github_pat_…`) — delete at
      <https://github.com/settings/tokens>
- [ ] Remove the bootstrap secret — **done** ✅
- [x] Delete the retired gateway secrets — **done** ✅ `CASHFREE_APP_ID`,
      `CASHFREE_SECRET_KEY`, `CASHFREE_ENV`, `RAZORPAY_KEY_ID`,
      `RAZORPAY_KEY_SECRET` unset. Only `PHONEPE_*` remains for payments.
- [ ] Rotate `PHONEPE_CLIENT_SECRET` — the current one was shared in chat, so
      regenerate it in the PhonePe dashboard and set it again

---

## 🟢 7. Data still to create

- [x] Create at least one **championship** (Admin → Championships) with
      categories, events, fees and deadlines — the app ships with none, by design
      (live: `state-meet-2026`, 15 categories, 22 events, cap 3)
- [x] Run a full **test registration** end to end (IDs, bib, receipt, admin view)
- [x] Remove **Aadhaar card collection** from registration (form, API, database
      writes and the payment gate) — payment now proceeds without an upload.
- [ ] Run the **test checklist** in `README.md`

---

## 🟢 8. Branding

**Complete:** the logo and exact association name have been received and
configured.

- [x] **Logo:** received `client's updates/CDMAA_logo.png` on 1 Nov 2026 and
      replaced the placeholder `AR` mark. Web assets are
      `public/brand/cdmaa-mark.png` (compact) and
      `public/brand/cdmaa-logo.png` (full). Used in the public header/footer,
      admin header, admin login page, and receipt
      (`src/components/AssociationLogo.tsx`).
- [x] **Header text:** changed to “Coimbatore District Masters Athletic
      Association” and “Self Registration Portal”
      (`src/lib/brand.ts`).
- [x] **Credentials line:** `Regd. No. 256/97 · Coimbatore`, as printed beneath
      the emblem on the client's logo, shown in the header, footer, admin
      sign-in, and receipt (`ASSOCIATION_CREDENTIALS`).
- [x] **Hero name:** set `site.organizer_name` to
      “Coimbatore District Masters Athletic Association” via
      `20261101000003_site_organizer_name.sql`.
- [x] **Favicon:** recoloured to the navy/red brand palette
      (`public/favicon.svg`). A square icon from the emblem is still optional if
      the client approves it.
- [x] **Verify:** deployed on 1 Nov 2026 and checked live — desktop and mobile
      header, hero, footer, register page, and registration form sections.

---

## 🟢 9. Handoff — transfer project to the client (end of project)

Supabase supports official **Project Transfers**; the project ref, URLs and
API keys stay identical, so **no code or Vercel changes** are needed — only
ownership/billing changes.

### Order of operations
1. **Decide ongoing access first.** After the transfer you lose dashboard
   access unless the client's organization adds you (or your GitHub) as
   Owner/Admin afterwards.
2. Client creates a Supabase account + organization (free plan is fine).
   ⚠️ Free plan limit: **2 projects per account** (across all orgs where they
   are Owner/Admin) — this project must fit within that.
3. You: Supabase Dashboard → **Project Settings → General → Danger zone →
   Transfer Project** → select the client's organization.
4. The client's org **Owner/Admin approves** the request → project moves.
5. Verify after transfer: `public-config` still 200, admin login works,
   Edge Functions still respond (nothing should change).

### Also hand over
- [ ] **GitHub repo** — add the client as collaborator (or transfer repo)
- [ ] **Vercel project** (`cdmaaregistration`) — transfer to their Vercel
      account or at minimum add them; env vars already set
- [ ] `README.md` + `TODO.md` (they contain the full project context;
      no secrets are committed)
- [ ] `.env` values (Supabase URL, anon key, site URL) — send securely
- [ ] Rotate personal tokens **before** handoff (see §6): Vercel `vcp_…`,
      GitHub `github_pat_…`, Supabase `sbp_…`
- [ ] PhonePe merchant account (if configured by then) must be the client's own —
      their merchant account, their webhook, their secrets

### Storage note (free plan)
- Database storage is **per project** (500 MB each) — the client's other
  projects do not share this quota. Current usage ~12 MB (~11 MB is fixed
  Supabase baseline; actual athlete data is ~1 KB for 2 registrations, so
  ~1.5–2 KB per athlete).
