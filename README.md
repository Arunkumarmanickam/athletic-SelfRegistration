# CDMAA Athlete Self-Registration Portal

Live site: **https://www.cdmaa.in** (Vercel) — backend: **Supabase** project
`urlkpbvvtossdzsjcmie` (project ref is embedded in `.env`).

A registration portal for a masters athletics championship. Athletes fill a
single-page form and upload an Aadhaar front image for DOB verification (image
is validated and then **discarded** — only a verified timestamp is kept). The
submission is held as a **draft**; the permanent Athlete ID and the bib number
are issued **only when the payment is captured**, so anyone who abandons the
payment gateway leaves nothing behind but a draft that is purged. Fees are paid
through Razorpay once configured. Administrators manage championships,
categories, events, athletes, payments and admin accounts from `/admin`.

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind, React Router |
| Hosting | Vercel (production branch `main`, node 24.x, project `cdmaaregistration`) |
| Backend | Supabase: Postgres + Deno Edge Functions |
| Payments | Razorpay (Test Mode keys configured 2026-10-19; live keys must come from the client's account) |
| Excel export | SheetJS (`xlsx`) imported inside the Edge Function from esm.sh |

## 2. Repository map

```
athlete-registration-portal/
├─ src/
│  ├─ pages/public/        Registration, status lookup, success pages
│  ├─ pages/admin/         Admin dashboard pages (see §5)
│  ├─ components/
│  │  ├─ registration/     RegistrationForm (the whole single-page flow),
│  │  │                    PaymentPanel (Razorpay checkout), PaymentReturnGate
│  │  │                    (redirect-return recovery), ReceiptInvoice (bill)
│  │  ├─ admin/            ExportBar, PageHeader
│  │  └─ ui/               Design system (Dialog, Table, SearchCombobox, …)
│  ├─ lib/                 api.ts (all API calls), types.ts, geo.ts, format.ts,
│  │                       paymentReturn.ts (redirect-return handling),
│  │                       receipt.ts + receiptPdf.ts (receipt + A4 PDF),
│  │                       amountWords.ts
│  └─ context/             ConfigContext, AdminAuthContext, ToastContext
├─ supabase/
│  ├─ functions/           Deno Edge Functions (see §4)
│  └─ migrations/          SQL migrations, applied in filename order
│                          (…20261020000003_registration_drafts.sql adds the
│                          draft + payment_orders tables;
│                          …20261020000004_draft_functions.sql adds
│                          create_registration_draft / promote_draft;
│                          …20261020000005_keep_alive.sql adds the pg_cron
│                          keep-alive job — see §7)
├─ TODO.md                 Open work: payments, email, security, credential rotation
└─ README.md               This file
```

## 3. How the pieces fit together

- **Public flow** (`/register`): `public-config` → categories/events/limits →
  `create_registration_draft` RPC (one Postgres function does ALL validation:
  window open, level-aware required fields, category, age, gender, event cap,
  fees, duplicate protection). It writes **one `registration_drafts` row** and
  returns a bearer **`draft_token`**.
- **Nothing is issued before payment** (migration
  `20261020000003_registration_drafts.sql` +
  `20261020000004_draft_functions.sql`). A draft has no
  `athlete_profile_id`, so there is **no athlete profile, no Athlete ID
  (`ATH-…`), no bib number and no `registrations` row** until the money is
  captured. Someone who fills the form and walks away at the payment gate
  leaves a single draft row, removed by `prune_registration_drafts()` once it
  expires (24 h, unless a live Razorpay order is still open).
- **Promotion**: on capture, `promote_draft(draft_id)` does everything in one
  transaction — reuse the existing profile when the same mobile + date of birth
  is already known (otherwise create it, which is where the **Athlete ID** is
  minted), create the confirmed registration and its events, assign the **bib**,
  carry the orders over, and delete the draft. It is **idempotent**: promoting
  again returns the same registration, so a webhook plus a browser callback
  cannot issue two bibs or two Athlete IDs.
- **Payments**: Razorpay Test Mode is live (`payments_configured: true`, base
  fee ₹500). `register` writes only the draft; `payment-retry` creates the
  Razorpay order **against the draft** (recorded in `payment_orders`, since
  `payments.registration_id` requires a real registration) once the draft has an
  Aadhaar upload. `PaymentPanel` opens checkout with `prefill` from the draft
  and **no method restriction** — every method enabled on the account appears.
  If UPI is missing, enable it in the Razorpay dashboard (Account & Settings →
  Payment Methods); it is not a code setting.
- **Redirect payments (net banking / bank UPI apps)**: these do **not** return
  through checkout.js's `handler` — the browser goes to the bank and comes back
  via Razorpay's `callback_url`, which **must accept a POST**. A static Vercel
  site answers POST with **405**, so `Callback_url` points at the
  **`payment-callback` Edge Function**: it verifies the signature server-side,
  promotes the draft, mints a single-use receipt token and **303-redirects** the
  browser to `/registration/success?receipt=<token>`. `receipt-token` exchanges
  that token once for the receipt (only its hash is stored, 30-minute TTL).
  Card and in-app UPI still use the checkout.js handler. `payment-callback` and
  `receipt-token` are deployed with `--no-verify-jwt`, because Razorpay POSTs
  without a Supabase JWT.
- **Checkout prefill**: the form collects name, date of birth, gender, mobile
  and an **optional email** (used on the receipt and in the Razorpay checkout).
  Both `register` and `payment-retry` return a `prefill` block
  (`{ name, email, contact }`) and `PaymentPanel` passes it to Razorpay, so the
  gateway does not ask the athlete for details they already typed. A retry
  re-reads the prefill from the server, so it still works after a page reload.
  Nothing is stored beyond what the athlete submitted.
- **Receipt**: a verified payment lands on `/registration/success`, which renders
  an invoice-style receipt (`src/components/registration/ReceiptInvoice.tsx`):
  organiser header, billed-to block, bib number, itemised events, totals, amount
  in words and the payment record. A real **PDF is generated in the browser**
  (`src/lib/receiptPdf.ts`, jsPDF, loaded lazily) and **downloaded automatically
  once per registration** — tracked per browser tab in `sessionStorage`, so a
  refresh never downloads twice and the athlete keeps a copy without touching
  the print dialog. The PDF is one A4 page, 14 mm side margins, with the
  organiser name from `public-config` (the download waits briefly for config so
  the letterhead is not blank). The on-screen invoice stays printable and there
  is a manual "Download PDF" button. Nothing is stored server-side.
- **Identity**: `athlete_profiles` are permanent (Athlete ID `ATH-2026-######`)
  and are created **only on payment**, by `promote_draft`. Duplicate protection
  keys on mobile + date of birth, so a returning athlete reuses their profile
  and Athlete ID rather than getting a second one. There is no OTP/SMS anywhere
  by design.
- **Geography**: `championships.nation` + `championships.state_name`.
  State meet = `nation='India'` + a `state_name`; national meet = a nation +
  `state_name = null`. On registration, a state meet asks for a district of
  that state, a national meet asks for a state (of that nation). Front-end
  lists live in `src/lib/geo.ts`; the searchable dropdown also accepts a typed
  value not in the list so a missing district can never block an athlete.
- **Defaults**: `default_categories` / `default_events` tables are global
  templates. Creating a championship snapshots them; the admin can add/remove
  per championship. The defaults themselves are changed only by migration.
- **Bib format**: `<M|W><min_age><seq>` e.g. `M4501`, `W35101` — generated by
  `generate_bib_number()` using race-safe per-scope counters (`id_sequences`),
  unique per championship. `assign_bib()` is idempotent and is called **only**
  from `promote_draft`, i.e. only once payment is captured.

## 4. Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `public-config` | Public championship + feature config (CORS-restricted to cdmaa.in + localhost); returns `payments_configured` |
| `register` | Validates everything and writes one `registration_drafts` row via `create_registration_draft`; returns a `draft_token` and a checkout `prefill` block. Issues no Athlete ID, no bib and no registration |
| `verify-athlete` / `retrieve-profile` | Session-based identity (no OTP) |
| `upload-document` | `purpose=aadhaar` validates the image against a **draft** (records the timestamp on the draft), then discards the file; `purpose=photo` needs an athlete session |
| `verify-payment` / `payment-webhook` | Razorpay verification + webhook (needs secrets); both promote the draft on capture |
| `payment-callback` | Receives Razorpay's **POST** for redirect payments (a static site would answer 405), verifies + promotes, then 303-redirects to the receipt |
| `receipt-token` | Exchanges a single-use receipt token for the confirmation payload |
| `payment-retry` | Creates the Razorpay order **against the draft** (in `payment_orders`) after the Aadhaar upload; returns the `prefill` |
| `admin-*` | `admin-me`, `admin-stats`, `admin-registrations`, `admin-athletes`, `admin-payments`, `admin-championships`, `admin-users`, `admin-audit`, `admin-export`, `admin-bootstrap` |
| `health` | Public keep-alive/liveness ping (no auth, returns no data). Called twice weekly by the `pg_cron` job and usable by an external uptime monitor — see §7 |

Shared helpers live in `_shared/`: `helpers.ts` (**`str()` returns `''` for
non-strings — never use it to test blankness of numeric fields; check
null/undefined/empty-string explicitly**), `admin-auth.ts` (`requireAdmin`),
`admin-queries.ts` (list/export share one query builder so exports always
match on-screen filters), `cors.ts` (`ALLOWED_ORIGINS`), `draft.ts`
(pre-payment draft tokens: `resolveDraft` / `newDraftToken`), `payments.ts`
(`markPaymentCaptured` — amount check, `promote_draft`, order/payment
transitions, confirmation email).

**Excel export** (`admin-export`): `kind` = `registrations` | `payments` |
`athletes`. The `athletes` kind writes the organiser's template layout with a
Mobile column added (sheet "Athletes": S.No, Name, Gender (M/W), Age Category,
DOB, Mobile, Representing, Event1..N, T-shirt size, Bib No; phone exported as
E.164 text, e.g. +919025054960) — T-shirt size is currently left blank
because the registration form does not collect it. The
`registrations`/`payments` kinds spell out **Men/Women** (the app never says
"Male/Female" anywhere). Exports are audited (`export.generated`) and
formula-injection safe (E.164 numbers starting with `+` are exempted from the
apostrophe guard).

## 5. Admin dashboard (`/admin`)

Sidebar (src/components/layout/AdminLayout.tsx → `ADMIN_LINKS`):
Overview · **Registrations** (full filters, sorting, column-picker export) ·
**Athletes** (championship chips: "All championships" + one per championship;
Export XLSX in template format for the current selection) · Payments ·
Championships (create/edit, per-championship categories/events, defaults) ·
Settings · Audit trail · Administrators (create with an owner-chosen password;
no one-time passwords — see `admin-users`; disabled accounts can be deleted
per-row or in bulk with "Delete inactive"; **only disabled accounts are
deletable**, the last active owner cannot be disabled, and only an owner can
delete an owner account).

Roles: `owner` (everything incl. administrators), `admin` (management),
`viewer` (read-only; `update` actions return `NOT_ALLOWED`). Payment status
can never be set to `paid` by hand — `admin-payments.reconcile` requires a
captured payment row first.

## 6. Deploy model — READ THIS FIRST

- **Frontend**: `git push origin main` → Vercel auto-builds and promotes to
  production (`cdmaa.in` + `www.cdmaa.in`).
- **Edge Functions**: manual — `supabase functions deploy <name> --use-api`
- **Migrations**: manual — `supabase db push --linked --include-all`
- `npm run dev` on localhost talks to the **same live Supabase project**.
  There is no staging environment. Every test writes real data.
- `npm run build` = `tsc --noEmit && vite build`. Run it before pushing.

Environment (mirrored in `.env` and Vercel project env vars):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.
Edge Function secrets are set with `supabase secrets set`
(`ALLOWED_ORIGINS`, `BOOTSTRAP_ADMIN_SECRET`, Razorpay keys). As of
2026-10-19 the **Razorpay Test Mode** keys are set as Supabase secrets only
(`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — never committed, never in the
repo). `payments_configured` is therefore `true` and a real test order can be
created end-to-end. `RAZORPAY_WEBHOOK_SECRET` and `RESEND_API_KEY` are still
unset, so a payment where the athlete closes the browser is not captured and
no confirmation email is sent.
Credentials are **not** committed; obtain them from the project owner or the
Supabase/Vercel dashboards. `TODO.md` tracks credential rotation — rotate any
token that was ever pasted into a chat or issue.

**Razorpay dashboard prerequisites** (none of these can be set from code):

- **Payment Methods → UPI must be enabled** for UPI to appear in the checkout.
  The app never restricts methods, so a missing UPI tile is always this setting.
- The site domain (`www.cdmaa.in`, plus `localhost` for testing) must be
  **allowlisted for callback/redirect URLs** — `PaymentPanel` sends net-banking
  returns to `<origin>/status`. An unallowlisted origin breaks redirect returns.
- Leave the webhook URL unset until `RAZORPAY_WEBHOOK_SECRET` exists; the
  redirect/handler paths verify payments without it.

## 7. Platform ownership, renewals and running costs

Read this before promising anyone "it will just keep working". **Only the
domain has a renewal date.** Everything else is either monthly or per
transaction, and the real risks are ownership and inactivity, not expiry.

| Platform | Renewal / expiry | If it is not renewed or maintained |
|---|---|---|
| **Domain `cdmaa.in`** | **Annual** — registered 2026-10-17, **expires 2027-10-17** (verified via RDAP) | The site becomes unreachable, and anyone can then register the name. Every receipt, email and QR code pointing at it would lead elsewhere. |
| **Vercel** (hosting + TLS) | **None** — monthly, cancel-anytime | Stops serving when the plan lapses. |
| **TLS certificate** | **Auto-renews every 90 days**, free | Nothing to do; Vercel renews it. (Currently issued by Let's Encrypt, `CN=www.cdmaa.in`.) |
| **Supabase** | **None** — but a **free** project is **paused after 1 week of inactivity**. Mitigated by a keep-alive job — see below. | Site loads but the database is unreachable, so registration fails. A paused project keeps its data and is restored from the dashboard in about a minute. |
| **Razorpay** | **None** — no setup fee, no AMC, no refund fee | Nothing expires. It is **2% per successful transaction** (+18% GST on that fee); UPI itself is zero-MDR, so the 2% is Razorpay's platform fee rather than a government charge. A ₹500 entry nets roughly ₹490. |

### Ownership — the real single point of failure

Both the repository and the Vercel project are currently on the **developer's**
personal accounts:

- GitHub: `github.com/Arunkumarmanickam/athletic-SelfRegistration`
- Vercel: project `cdmaaregistration`, serving `cdmaa.in` / `www.cdmaa.in`

The same principle applied to Razorpay — *the account must belong to the client,
not the deliverer* — applies here. If the site lives on one person's account,
then only that person can deploy a fix on event day, and a falling-out or an
unavailable developer strands the client's live event site. **Transferring costs
nothing and needs no downtime.**

Transfer outline (do this when the client has both accounts ready):

1. Create/confirm a GitHub account (or org) for the organiser.
2. **Transfer the repository** — GitHub → Settings → General → Danger Zone →
   *Transfer ownership*. (Or transfer to an organisation both parties are in.)
3. Create/confirm a **Vercel account on the organiser's email** (the same
   identity used for Razorpay KYC), then import the repository as a new project
   with the same build settings (framework Vite, node 24.x, output `dist/`).
4. Re-create the environment variables in the new project:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.
5. **Move the domain** to the new project. The old project keeps serving until
   DNS resolves to the new one, so visitors see **no outage**; then remove the
   domain from the old project.
6. Verify the same way every change in this repo is verified: check the served
   bundle hash matches the build, then run one registration and one status
   lookup.

The Supabase project (`urlkpbvvtossdzsjcmie`) and the Razorpay account are also
on individual accounts and should be transferred the same way before the client
is billed directly.

### Vercel plan: Hobby vs Pro — documented trade-off

Vercel's **Hobby** plan is licensed for *"personal, non-commercial use"*; Pro
($20/month) covers freelancers and businesses. This site takes real money for a
real event, so strictly it belongs on Pro.

That licence question is **not** affected by moving the project to the client —
an individual on Hobby is on Hobby either way, with identical terms. So:

- **Transfer ownership regardless.** It is free and removes the real risk.
- **Staying on Hobby is a deliberate, deferred risk.** Vercel does not scan
  projects for commercial use; the constraint tends to surface during a
  support, abuse or compliance review rather than in normal operation. For a
  once-a-year district meet the practical exposure is low.
- **Middle path**: Vercel bills monthly with no lock-in, so Pro can be enabled
  for the event months only (roughly ₹2,000–3,500/year) and dropped back to
  Hobby afterwards.
- **Not recommended**: paying $20/month ($240/year) year-round. For this
  workload the paid tier buys nothing technical — Hobby already includes
  unlimited deployments, 1M CDN requests/month, 100 GB transfer and automatic
  TLS, while traffic is a few thousand athletes for a few weeks a year.

**Decision status:** documented only — no account changes have been made. The
organiser currently has **one** of the two required accounts, so the transfer
above is pending until they hold both. Revisit before the next edition.

**Calendar reminders to set:**

- **September 2027** — renew `cdmaa.in` (do it early; do not wait for the
  expiry date itself).
- **Before that** — check whether the Supabase project has been paused, or move
  it to a paid plan if the gap between editions is long.

### Supabase inactivity and the keep-alive job

The portal is dormant for most of the year — a championship runs for a few
weeks, then nothing until the next edition. Supabase pauses **free** projects
after a week without activity. A paused project keeps all its data and is
restored from the dashboard in about a minute, so this is an **availability**
risk (a registration window lost), not a data-loss risk.

Two layers cover it.

**Layer 1 — scheduled keep-alive (implemented, free).**
Migration `20261020000005_keep_alive.sql` enables `pg_cron` and `pg_net` and
schedules a twice-weekly call to the public `health` Edge Function
(Monday and Thursday, 06:00 UTC — the gap can never approach a week).

- `supabase/functions/health` deliberately runs a **real but empty** database
  query (`head: true`, no rows), so a response proves the database answered.
  A paused project's API can still reply, so a static "I'm alive" would be a
  misleading signal. It returns `503` when the database is unreachable and
  exposes no data of any kind.
- **The 20-second timeout is deliberate and was verified, not guessed.** At
  5000 ms the call *times out* — a cold Edge Function needs longer — and
  `net._http_response` recorded `timed_out = true`. That failure mode is
  invisible: the job looks scheduled and healthy while doing nothing. Do not
  lower it without re-verifying.
- **Verified working end-to-end**: scheduler → `pg_net` → function → DB query
  returned `200 {"ok":true,"database":"ok"}`.

To check it is still firing:

```sql
select jobid, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 5;

select id, status_code, timed_out, left(content, 80)
from net._http_response order by id desc limit 5;
```

**Layer 2 — external uptime monitor (recommended, free).**
The cron can only prove the database is awake. A free monitor (UptimeRobot,
Better Stack, cron-job.org) pointed at
`https://urlkpbvvtossdzsjcmie.supabase.co/functions/v1/health` every
**5–10 minutes** adds real inbound traffic *and* emails you when the response
is not `200` — catching a paused project, a broken deploy, DNS problems and
Vercel outages, not just inactivity. Set the alert contact to the organiser as
well as the developer.

**Layer 3 — manual, the guaranteed recovery.** Open the Supabase dashboard the
day before registration opens. If the project shows as paused, click Restore.
This is the documented last resort and takes about a minute.

> Note: Supabase's one-week timer is officially based on project activity, so an
> in-database cron is very likely — but not contractually guaranteed — to
> prevent pausing. A paid plan is the only certain fix; Layers 1 and 2 together
> are the free equivalent, and Layer 2 tells you when it has failed.

## 8. PowerShell / Windows gotchas

- `npm`/`supabase` scripts fail directly (execution policy) → use `cmd /c "…"`.
- Git: run `& "C:\Program Files\Git\cmd\git.exe" …`; `git push origin HEAD`
  succeeds even though stderr progress output makes it look like exit 1.
- Inline SQL gets mangled by quoting → write SQL to a file under
  `C:\Users\WELCOME\AppData\Local\Temp\opencode` and run
  `supabase db query --linked --file <path>`.

## 9. Error codes

`MISSING_FIELDS`, `INVALID_FIELDS`, `INVALID_EMAIL`, `INVALID_PASSWORD`,
`UNKNOWN_ACTION`, `CHAMPIONSHIP_NOT_FOUND`, `REGISTRATION_CLOSED`,
`NOT_OPEN_YET`, `DEADLINE_PASSED`, `ALREADY_REGISTERED`,
`SESSION_EXPIRED`, `CATEGORY_REQUIRED`, `CATEGORY_INVALID`,
`GENDER_NOT_ELIGIBLE`, `AGE_NOT_ELIGIBLE`, `EVENTS_REQUIRED`,
`EVENT_INVALID`, `EVENT_GENDER_NOT_ELIGIBLE`, `EVENT_CATEGORY_NOT_ELIGIBLE`,
`TOO_MANY_EVENTS`, `AADHAAR_REQUIRED`, `PAYMENTS_NOT_CONFIGURED`,
`NO_VERIFIED_PAYMENT`, `NOT_ALLOWED`, `ALREADY_EXISTS`, `NOT_INACTIVE`,
`LAST_OWNER`, `NOT_FOUND`, `DRAFT_NOT_FOUND`, `MISSING_TOKEN`,
`PROMOTE_FAILED`, `PAYMENT_NOT_CAPTURABLE`.

There is **no pay-later path**: an entry only exists after payment, so `/status`
looks up confirmed registrations only and advises anyone who abandoned the
payment gate to register again (nothing was saved, so nothing duplicates).

Payment verification (`verify-payment`) additionally returns:
`PAYMENT_NOT_FOUND`, `INVALID_SIGNATURE`, `PAYMENT_MISMATCH`,
`PAYMENT_NOT_COMPLETED`, `AMOUNT_MISMATCH`, `PAYMENT_FAILED`. A redirect-based
payment that fails any of these shows the message on `/status`.

## 10. Current state & next steps

Done: registration portal, Aadhaar-verified DOB, event caps (cap enforced
in UI **and** in `create_registration_draft`), geography-aware representing,
championship defaults, admin password chosen at creation, dialog focus fix,
Vercel env vars fixed, **Athlete ID + bib issued only after payment via
`promote_draft` (drafts carry unpaid submissions and are purged)**, **championship-wise
Athletes tab + template-format XLSX export**, **Mobile column in the athletes
export (E.164 text, no stray apostrophe)**, **Men/Women wording everywhere
(UI + exports) — the strings "Male"/"Female" do not exist in the codebase**,
**relay events removed** (they were not part of the athletics programme),
**invoice-style
receipt with auto-downloading PDF**, **admin account deletion (disabled
accounts only, per-row + bulk)**, **Razorpay Test Mode keys set and a real
test order created end-to-end**, **registration form collects an optional
email**, **Razorpay checkout is prefilled with name/email/mobile**,
**redirect-based payments (net banking / bank UPI apps) return via Razorpay's
POST to `payment-callback`, are verified server-side and land on the receipt**.

Open (see `TODO.md`):
1. **Enable UPI in the Razorpay dashboard** (Account & Settings → Payment
   Methods). UPI is supported by checkout.js and the app does not restrict
   methods, so a missing UPI tile is a dashboard setting, not a code problem.
2. Finish a test payment (card `4111 1111 1111 1111`, OTP `1234`, or UPI
   `success@razorpay`) → confirm the **bib and Athlete ID are issued only now**,
   `payment_status = paid`, `status = confirmed`, receipt auto-download, and the
   payment visible in Admin → Payments. **UPI is unavailable on the Test Mode
   account**, so it must be tested on the client's Live account.
3. Configure the webhook (`RAZORPAY_WEBHOOK_SECRET`) so a payment survives the
   athlete closing the browser.
4. Set `organizer_name` in config — the receipt letterhead currently falls back
   to "Champion organiser".
5. Email provider for confirmation emails (best-effort today; `RESEND_API_KEY`).
6. Swap the Test Mode keys for the **client's own** Razorpay account
   (their email, KYC and bank) before taking real money — Live Mode needs the
   client's account, not the developer's.
7. Remove the Razorpay test secrets once testing is finished.
8. Production security review; credential rotation (see `TODO.md`).
9. Any championship edited before the max-events fix may still have a blank
   `max_events_per_athlete` — check Admin → Championships before opening.
10. **Transfer repository + Vercel project (+ Supabase, Razorpay) to the
    organiser's accounts** — see §7. The site currently deploys only from the
    developer's personal accounts. Needs the organiser to hold a GitHub *and*
    a Vercel account; they currently have one of the two.
11. **Renew `cdmaa.in` by September 2027** (expires 2027-10-17) — calendar it.
12. **Check the Supabase project is not paused** before each edition (free
    projects pause after a week without traffic). A twice-weekly `pg_cron`
    keep-alive now guards this — see §7. Still worth adding a **free external
    uptime monitor** on `/functions/v1/health` so a genuine outage emails you.

Testing checklist: register at `/register` → **no bib and no Athlete ID yet**
(the panel says "Issued after payment") → pay → receipt downloads once and
shows Men/Women, the Mobile column and the invoice layout → the bib and Athlete
ID now appear in Admin → Athletes under the right championship chip → Export
XLSX matches the `athlete-bulk-import-template` column layout. Abandoning at the
payment gate must leave **no** profile, bib or registration — only a draft.
