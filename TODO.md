# TODO — Athlete Registration Portal

Everything below is **deliberately not configured yet**. The app behaves
honestly in the meantime: it reports `payments_configured: false` instead of
pretending it works. (OTP/SMS has been removed from the product entirely —
returning athletes verify with their Athlete ID + date of birth, no SMS
involved.)

---

## 🔴 1. Razorpay payments (skipped for now)

**Status:** not configured. Registering works, but athletes cannot pay.

### 1a. Get test keys
1. Create/sign in at <https://dashboard.razorpay.com> and stay in **Test mode**.
2. **Settings → API Keys → Generate Key Pair**.
3. Copy the **Key ID** (`rzp_test_…`) and **Key Secret**.

### 1b. Set them as Supabase secrets
```bash
supabase login --token <sbp_TOKEN>
supabase link --project-ref urlkpbvvtossdzsjcmie

# generate a webhook secret once, then reuse the same value on Razorpay
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx \
  RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx \
  RAZORPAY_WEBHOOK_SECRET=<long-random-string>
```

### 1c. Add the webhook
**Settings → Webhooks → Add webhook**
- URL: `https://urlkpbvvtossdzsjcmie.supabase.co/functions/v1/payment-webhook`
- Secret: **the same value** as `RAZORPAY_WEBHOOK_SECRET`
- Events: at minimum `payment.captured`, `payment.failed`
  (add `payment.authorized`, `refund.processed` if offered)

### 1d. Verify
- Reload `/admin` → Overview should show payments as configured.
- The public home page should stop showing the "payments not configured" notice.
- Run a test payment with Razorpay test cards:
  <https://razorpay.com/docs/payments/payments/test-card-details/>

### 1e. Going live (real money)
1. Complete Razorpay **merchant/account approval**.
2. Switch to **live** keys, update `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
3. Update the webhook URL/secret for live events.
4. Re-test with a real (small) payment.

> ⚠️ **Live payments will not work until approval is complete and live keys
> are configured.** Do not accept real money before that.

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
- [ ] Razorpay live keys (item 1) — if accepting real money.
- [ ] Move the repo **private** if the source should not be public.

---

## 🟢 5. Deploy

- [x] Push to GitHub — `https://github.com/Arunkumarmanickam/athletic-SelfRegistration`
- [x] Import into Vercel, build `npm run build`, output `dist`
- [x] Domain connected — `https://www.cdmaa.in` (apex `cdmaa.in` redirects to www)
- [ ] Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL` in
      Vercel → **Settings → Environment Variables**, scoped to **Production**,
      then redeploy. The values are baked into the bundle at build time, so a
      deployment built before the variables existed keeps reporting
      "The backend is not configured yet" no matter how often the page is
      reloaded. Setting a variable is not enough — a **new build** is required.
- [x] Add the Vercel domain to `ALLOWED_ORIGINS` and redeploy functions
      (secrets take effect immediately, no function redeploy needed)

---

## 🟢 6. Credentials to delete

- [ ] Supabase CLI token (`sbp_…`) — delete at
      <https://supabase.com/dashboard/account/tokens> once Razorpay secrets are set
- [ ] GitHub tokens (`ghp_…` / `github_pat_…`) — delete at
      <https://github.com/settings/tokens>
- [ ] Remove the bootstrap secret — **done** ✅

---

## 🟢 7. Data still to create

- [ ] Create at least one **championship** (Admin → Championships) with
      categories, events, fees and deadlines — the app ships with none, by design
- [ ] Run a full **test registration** end to end (IDs, bib, receipt, admin view)
- [ ] Run the **test checklist** in `README.md`
