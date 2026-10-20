# CDMAA Athlete Self-Registration Portal

Live site: **https://www.cdmaa.in** (Vercel) — backend: **Supabase** project
`urlkpbvvtossdzsjcmie` (project ref is embedded in `.env`).

A registration portal for a masters athletics championship. Athletes register
themselves (single-page form), get a permanent Athlete ID and an immediate bib
number, upload an Aadhaar front image for DOB verification (image is validated
and then **discarded** — only `aadhaar_verified_at` is stored), and pay a fee
through Razorpay once it is configured. Administrators manage championships,
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
│  │  │                    PaymentPanel (Razorpay checkout), ReceiptInvoice (bill)
│  │  ├─ admin/            ExportBar, PageHeader
│  │  └─ ui/               Design system (Dialog, Table, SearchCombobox, …)
│  ├─ lib/                 api.ts (all API calls), types.ts, geo.ts, format.ts,
│  │                       receiptPdf.ts (A4 PDF receipt), amountWords.ts
│  └─ context/             ConfigContext, AdminAuthContext, ToastContext
├─ supabase/
│  ├─ functions/           Deno Edge Functions (see §4)
│  └─ migrations/          SQL migrations, applied in filename order
├─ TODO.md                 Open work: payments, email, security, credential rotation
└─ README.md               This file
```

## 3. How the pieces fit together

- **Public flow** (`/register`): `public-config` → categories/events/limits →
  optional athlete verification (mobile + DOB, no OTP anywhere) →
  `create_registration` RPC (one Postgres function does ALL validation:
  window open, category, age, gender, event cap, fees, duplicate protection).
  The RPC returns the reference code `R######` **and the bib number — bibs are
  issued at registration time, before payment** (migration
  `20261019000001_bib_at_registration.sql`). Payment is only needed to move
  `payment_status` to `paid` / `status` to `confirmed`.
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
- **Payments**: Razorpay Test Mode is live (`payments_configured: true`,
  base fee ₹500). `register` creates the registration **without** an order;
  `payment-retry` creates the order once `aadhaar_verified_at` is set. The
  checkout is opened by `PaymentPanel` with `prefill` from the registration and
  **no method restriction** — every method enabled on the account (including
  UPI) appears. If UPI is missing, enable it in the Razorpay dashboard
  (Account & Settings → Payment Methods); it is not a code setting. The webhook
  is not configured yet, so a payment abandoned mid-redirect is only captured
  when the athlete returns to the success page.
- **Redirect payments (net banking / bank UPI apps)**: these do **not** return
  through checkout.js's `handler` — the browser goes to the bank and comes back
  with the result in the URL. `PaymentPanel` therefore sets
  `callback_url: <origin>/status` + `redirect: true`, and
  `PaymentReturnGate` (wrapping the public routes in `App.tsx`) detects
  `razorpay_payment_id`/`razorpay_order_id`/`razorpay_signature` on landing,
  calls the same `verify-payment` function, stores the confirmation and routes
  to `/registration/success` (receipt + auto-download). Query parameters are
  stripped afterwards so a refresh cannot replay verification. A bank failure
  return (`error[code]` / `error[description]`) is shown on `/status`. Card and
  in-app UPI keep using the `handler` — both paths end in the same verification.
  Logic lives in `src/lib/paymentReturn.ts`.
- **Identity**: `athlete_profiles` are permanent (Athlete ID `ATH-2026-######`).
  Duplicate protection keys on mobile + date of birth. An athlete session
  token (15 days) lets an athlete re-enter and edit before paying. There is
  no OTP/SMS anywhere by design.
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
  unique per championship. `assign_bib()` is idempotent and is called by
  `create_registration` (immediately) and by payment capture (no-op once set).

## 4. Edge Functions (`supabase/functions/`)

| Function | Purpose |
|---|---|
| `public-config` | Public championship + feature config (CORS-restricted to cdmaa.in + localhost); returns `payments_configured` |
| `register` | Creates a registration via the `create_registration` RPC; returns a checkout `prefill` block |
| `verify-athlete` / `retrieve-profile` | Session-based identity (no OTP) |
| `upload-document` | Validates the Aadhaar front image, records `aadhaar_verified_at`, discards file |
| `verify-payment` / `payment-webhook` | Razorpay verification + webhook (needs secrets) |
| `payment-retry` | Creates the Razorpay order after Aadhaar upload; returns the `prefill` and current fee |
| `admin-*` | `admin-me`, `admin-stats`, `admin-registrations`, `admin-athletes`, `admin-payments`, `admin-championships`, `admin-users`, `admin-audit`, `admin-export`, `admin-bootstrap` |

Shared helpers live in `_shared/`: `helpers.ts` (**`str()` returns `''` for
non-strings — never use it to test blankness of numeric fields; check
null/undefined/empty-string explicitly**), `admin-auth.ts` (`requireAdmin`),
`admin-queries.ts` (list/export share one query builder so exports always
match on-screen filters), `cors.ts` (`ALLOWED_ORIGINS`), `payments.ts`
(`markPaymentCaptured` — amount check, status transitions, `assign_bib`,
confirmation email).

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

## 7. PowerShell / Windows gotchas

- `npm`/`supabase` scripts fail directly (execution policy) → use `cmd /c "…"`.
- Git: run `& "C:\Program Files\Git\cmd\git.exe" …`; `git push origin HEAD`
  succeeds even though stderr progress output makes it look like exit 1.
- Inline SQL gets mangled by quoting → write SQL to a file under
  `C:\Users\WELCOME\AppData\Local\Temp\opencode` and run
  `supabase db query --linked --file <path>`.

## 8. Error codes

`MISSING_FIELDS`, `INVALID_FIELDS`, `INVALID_EMAIL`, `INVALID_PASSWORD`,
`UNKNOWN_ACTION`, `CHAMPIONSHIP_NOT_FOUND`, `REGISTRATION_CLOSED`,
`NOT_OPEN_YET`, `DEADLINE_PASSED`, `ALREADY_REGISTERED`,
`SESSION_EXPIRED`, `CATEGORY_REQUIRED`, `CATEGORY_INVALID`,
`GENDER_NOT_ELIGIBLE`, `AGE_NOT_ELIGIBLE`, `EVENTS_REQUIRED`,
`EVENT_INVALID`, `EVENT_GENDER_NOT_ELIGIBLE`, `EVENT_CATEGORY_NOT_ELIGIBLE`,
`TOO_MANY_EVENTS`, `AADHAAR_REQUIRED`, `PAYMENTS_NOT_CONFIGURED`,
`NO_VERIFIED_PAYMENT`, `NOT_ALLOWED`, `ALREADY_EXISTS`, `NOT_INACTIVE`,
`LAST_OWNER`, `NOT_FOUND`.

Payment verification (`verify-payment`) additionally returns:
`PAYMENT_NOT_FOUND`, `INVALID_SIGNATURE`, `PAYMENT_MISMATCH`,
`PAYMENT_NOT_COMPLETED`, `AMOUNT_MISMATCH`, `PAYMENT_FAILED`. A redirect-based
payment that fails any of these shows the message on `/status`.

## 9. Current state & next steps

Done: registration portal, Aadhaar-verified DOB, event caps (cap enforced
in UI **and** in `create_registration`), geography-aware representing,
championship defaults, admin password chosen at creation, dialog focus fix,
Vercel env vars fixed, **bibs issued at registration**, **championship-wise
Athletes tab + template-format XLSX export**, **Mobile column in the athletes
export (E.164 text, no stray apostrophe)**, **Men/Women wording everywhere
(UI + exports) — the strings "Male"/"Female" do not exist in the codebase**,
**relay events removed** (championship now has 20 events), **invoice-style
receipt with auto-downloading PDF**, **admin account deletion (disabled
accounts only, per-row + bulk)**, **Razorpay Test Mode keys set and a real
test order created end-to-end**, **registration form collects an optional
email**, **Razorpay checkout is prefilled with name/email/mobile**,
**redirect-based payments (net banking) are recovered from the return URL and
land on the receipt**.

Open (see `TODO.md`):
1. **Enable UPI in the Razorpay dashboard** (Account & Settings → Payment
   Methods). UPI is supported by checkout.js and the app does not restrict
   methods, so a missing UPI tile is a dashboard setting, not a code problem.
2. Finish a test payment (card `4111 1111 1111 1111`, OTP `1234`, or UPI
   `success@razorpay`) → confirm `payment_status = paid`, `status = confirmed`,
   receipt auto-download, and the payment visible in Admin → Payments.
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

Testing checklist: register at `/register` → bib appears immediately →
shows in Admin → Athletes under the right championship chip → Export XLSX
matches the `athlete-bulk-import-template` column layout → pay → receipt
downloads once and shows Men/Women, the Mobile column and the invoice layout.
