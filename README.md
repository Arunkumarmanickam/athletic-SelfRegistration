# Athlete Registration Portal

A complete, standalone portal for athletics championships. Athletes register
themselves through a public website, pay entry fees online, and receive a
permanent **Athlete ID** plus a championship-specific **Registration ID** (which
is also their **Bib Number**). Administrators manage everything from a secured
dashboard and can export real Excel workbooks.

This project is **independent**. It does not read from, write to, or depend on
any other website or database. It contains no results-management features.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Quick start (local)](#quick-start-local)
5. [Supabase setup](#supabase-setup)
6. [Razorpay setup](#razorpay-setup)
7. [Creating the first administrator](#creating-the-first-administrator)
8. [Environment variables](#environment-variables)
9. [Running the app](#running-the-app)
10. [Deploying to Vercel](#deploying-to-vercel)
11. [Testing payments and webhooks](#testing-payments-and-webhooks)
12. [Test checklist](#test-checklist)
13. [Troubleshooting](#troubleshooting)
14. [Security notes](#security-notes)
15. [Design decisions in plain English](#design-decisions-in-plain-english)
16. [Project structure](#project-structure)

---

## What it does

**For athletes (public site)**

- Browse open championships on the home page.
- Multi-step, validated registration form (personal details → participation →
  review) with a saved draft so a refresh does not lose progress.
- On first registration, a **permanent Athlete ID** is issued.
- On later registrations, the same Athlete ID is reused — it is never
  re-issued.
- Pay by UPI/card/net-banking through Razorpay; the fee is calculated
  **server-side** and never trusted from the browser.
- A printable receipt after a verified payment.
- **Returning athletes** can retrieve their profile with an Athlete ID (or
  mobile number + date of birth) plus a one-time password (OTP) sent by SMS.
- Look up a registration's status with the Registration ID and registered
  mobile number.

**For administrators (`/admin`)**

- Secure email/password sign-in. No public admin sign-up.
- Overview dashboard: totals, paid/pending/failed/refunded, breakdown by
  championship, gender and state, and recent registrations.
- Registrations table with search, filters, sorting, pagination, a detail view,
  safe editing (with a required reason), payment history and audit trail.
- Athletes list and profile detail with safe editing.
- Payments list with Razorpay details, refunds, failed marking and
  reconciliation.
- Championships manager: create/update/archive championships, and manage
  categories, events, fees, deadlines and form fields.
- Real **`.xlsx` exports**: filtered, all, per-championship, or chosen columns;
  a separate payment export. Exports use the full matching dataset, not just the
  visible page.
- Administrators manager with roles (owner/admin/viewer).
- Global settings (organisation details, Athlete ID format).
- Full audit trail of administrative actions.

---

## Architecture

- **Frontend:** React + Vite + TypeScript, Tailwind CSS, accessible
  shadcn-style components, React Router.
- **Backend:** Supabase (PostgreSQL + Edge Functions). All business logic —
  eligibility, fees, ID generation, payments, exports — runs in Edge Functions
  with the **service-role key**, which is never sent to the browser.
- **Database access:** public/anonymous users can only call Edge Functions. Every
  table has Row Level Security enabled with **no public policies**, and table
  privileges are revoked from the `anon`/`authenticated` roles.
- **Payments:** Razorpay. Orders are created server-side; signatures are verified
  server-side; webhooks are verified and processed idempotently.
- **IDs:** Athlete IDs come from a global sequence. Bib/Registration IDs are
  derived from the athlete's sex and age category — `M`/`W`, then the lower
  bound of their age bracket, then a sequence (`M4501`, `W4501`, and `W35101`
  for the 101st woman in the 35+ bracket). The sequence is scoped per
  championship, sex and category and guarded by a row lock and a unique
  constraint, so two simultaneous registrations can never receive the same bib.
- **Exports:** generated server-side with SheetJS and streamed as `.xlsx`.

---

## Requirements

- Node.js 20 or newer (Node 18+ should work; the admin script uses the built-in
  `fetch`).
- A Supabase project (free tier is fine to start).
- A Razorpay account (test mode is enough to try the flow).
- The Supabase CLI (recommended) **or** access to the Supabase dashboard SQL
  editor and Edge Functions UI.
- An SMS provider (Twilio or MSG91) for production OTPs. Optional in
  development.

---

## Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
copy .env.example .env      # Windows
# cp .env.example .env      # macOS/Linux

# 3. Fill in .env (at minimum the two VITE_ values and the service role key)

# 4. Set up Supabase (see below), then run the dev server
npm run dev
```

The app runs at <http://localhost:5173> by default; the admin area is at
<http://localhost:5173/admin>.

> If the Supabase URL/anon key are missing, the app shows a friendly
> "Backend not configured" message instead of crashing.

---

## Supabase setup

### 1. Create a project

Create a project at <https://supabase.com/dashboard>. Note the **Project URL**,
the **anon public key** and the **service_role key** (Project Settings → API).

### 2. Apply the database migrations

The SQL files live in `supabase/migrations/` and must be applied **in order**:

1. `20261016000001_init_schema.sql` — tables, indexes, sequences.
2. `20261016000002_functions.sql` — helper functions (sequences, rate limits,
   registration creation, etc.).
3. `20261016000003_security.sql` — RLS, revoked privileges, the private storage
   bucket.
4. `20261016000004_admin_aggregates.sql` — dashboard aggregate helpers.

**Option A — Supabase CLI (recommended)**

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

**Option B — Dashboard SQL editor**

Open the SQL editor and run each file's contents in the order above.

### 3. Deploy the Edge Functions

Every folder under `supabase/functions/` (except `_shared`, which is imported by
the others) is a function that must be deployed:

```
public-config            request-otp            verify-otp
retrieve-profile         register               payment-retry
verify-payment           payment-webhook        lookup-registration-status
upload-document          admin-bootstrap        admin-me
admin-stats              admin-registrations    admin-athletes
admin-payments           admin-audit            admin-users
admin-championships      admin-export
```

With the CLI:

```bash
supabase functions deploy
```

Or deploy one at a time from the dashboard (Edge Functions → Create function),
pasting each `index.ts`. Keep the `_shared` folder alongside them — the CLI
bundles it automatically.

### 4. Set the Edge Function secrets

Server-only variables are configured as **Edge Function secrets**, never in the
frontend. With the CLI:

```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=... \
  RAZORPAY_KEY_ID=... \
  RAZORPAY_KEY_SECRET=... \
  RAZORPAY_WEBHOOK_SECRET=... \
  BOOTSTRAP_ADMIN_SECRET=... \
  SMS_PROVIDER=none \
  ALLOWED_ORIGINS=http://localhost:5173
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to functions automatically in the Supabase environment, but setting
`SUPABASE_SERVICE_ROLE_KEY` explicitly is harmless and makes local testing
clearer.

---

## Razorpay setup

1. Create an account and stay in **Test mode** while developing.
2. Settings → API Keys → generate a key pair. Put the **Key ID** and **Key
   Secret** into the Edge Function secrets (`RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`). These are server-only.
3. Settings → Webhooks → add a webhook:

   - **URL:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/payment-webhook`
   - **Secret:** a long random string; set the same value as
     `RAZORPAY_WEBHOOK_SECRET`.
   - **Active events:** at minimum `payment.captured` and `payment.failed`
     (add `payment.authorized`, `refund.processed` if available).

4. To go live you must complete Razorpay's merchant/account approval, switch to
   live keys, and update the secrets. **Do not expect live payments to work
   until approval is complete and the live keys are configured.** Until then the
   app deliberately reports that payments are not configured.

---

## Creating the first administrator

There is **no public admin sign-up**. The very first owner is created in one of
two ways.

**Option A — the setup panel on the login page**

1. Set `BOOTSTRAP_ADMIN_SECRET` as an Edge Function secret.
2. Visit `/admin/login`, expand **First-time setup**, and enter the secret, your
   email and a password.
3. The owner account is created. Store the credentials, then remove the
   bootstrap secret.

**Option B — the command-line script**

```bash
npm run create-admin -- --email owner@example.org --name "Jane Doe"
```

The script reads `.env` (or the environment) for `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` and `BOOTSTRAP_ADMIN_SECRET`, calls the
`admin-bootstrap` function, and prints a one-time password if you did not supply
one. It refuses to run once an active owner already exists.

After the first owner exists, add further administrators from
**Admin → Administrators**, choosing a role:

- **owner** — full access, including managing other owners.
- **admin** — manage registrations, payments and championships.
- **viewer** — read-only.

> The **organiser, championship details, categories, events, fees, deadlines and
> eligibility rules are all configured by you** in Admin → Championships. The
> app ships with none of them, deliberately.

---

## Environment variables

Copy `.env.example` to `.env`. Summary:

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL (public). |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anon key (public). |
| `VITE_SITE_URL` | Frontend | Public site URL, used in links/redirects. |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions | Full DB access. **Never** in the browser. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Edge Functions | Razorpay API credentials. |
| `RAZORPAY_WEBHOOK_SECRET` | Edge Functions | Verifies webhook signatures. |
| `BOOTSTRAP_ADMIN_SECRET` | Edge Functions | One-time secret to create the first owner. |
| `SMS_PROVIDER` | Edge Functions | `none`, `twilio` or `msg91`. |
| `TWILIO_*` / `MSG91_*` | Edge Functions | Credentials for the chosen SMS provider. |
| `OTP_DEV_MODE` | Edge Functions | Dev only: returns OTP in the response for localhost. |
| `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` | Edge Functions | Optional email confirmations. |
| `ALLOWED_ORIGINS` | Edge Functions | Comma-separated origins allowed to call the API. |

---

## Running the app

```bash
npm run dev       # development server with hot reload
npm run build     # type-check (tsc --noEmit) + production build to dist/
npm run preview   # serve the production build locally
```

---

## Deploying to Vercel

1. Push this project to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel, **New Project → Import** the repository.
3. Framework preset: **Vite**. Build command `npm run build`, output directory
   `dist`. (A `vercel.json` is included so client-side routes like
   `/registration/success` and `/admin/...` work on refresh.)
4. Add the **frontend** environment variables in Vercel → Settings → Environment
   Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`
   (and any others prefixed `VITE_`). Do **not** add the service-role or Razorpay
   secret keys here — they belong only in Supabase Function secrets.
5. Deploy.
6. Back in Supabase, add your Vercel domain to `ALLOWED_ORIGINS` and redeploy the
   functions, and update the Razorpay webhook URL if your project ref changed.

---

## Testing payments and webhooks

1. Configure Razorpay **test** keys and the webhook secret as function secrets,
   then confirm Admin → Overview shows payments as configured (or check the
   public site does not show a "payments not configured" notice).
2. Register an athlete and choose to pay. Use Razorpay test cards
   (<https://razorpay.com/docs/payments/payments/test-card-details/>).
3. On success, the app calls `verify-payment`, which checks the HMAC signature
   server-side before marking anything paid, then shows the receipt.
4. To test webhooks locally, expose your local functions with
   `supabase functions serve` plus a tunnel (e.g. ngrok), point a Razorpay test
   webhook at the tunnel URL, and send a test event. Webhooks are verified and
   processed **idempotently** — replaying the same event will not double-count.
5. Test the awkward cases: a cancelled payment, a failed payment, a pending
   payment, and a duplicate/late webhook. The registration should end up in a
   consistent state (never "paid" without a verified, captured payment).

> Reconciliation: an administrator can mark a registration as paid **only** when
> a captured (verified) payment row exists for it. The app refuses otherwise, to
> prevent accidental or fraudulent status changes.

---

## Test checklist

Use this before going live. Tick each item in a staging environment first.

**Public registration**

- [ ] Home page lists only `open` championships.
- [ ] Registration form validates required fields and keeps a draft across a
      refresh.
- [ ] Age eligibility is enforced against the configured cutoff; ineligible
      categories/events cannot be selected.
- [ ] Fee shown equals the fee the server calculates (change categories/events
      and confirm the total updates).
- [ ] A brand-new athlete receives an Athlete ID and a bib/Registration ID.
- [ ] Registering again for a second championship **reuses** the same Athlete ID
      and issues a **new** bib.
- [ ] Registering twice for the **same** championship is blocked for a
      paid/confirmed registration.
- [ ] Registering when the championship is closed / past the deadline / not yet
      open shows a clear message.

**Returning athlete / OTP**

- [ ] Requesting an OTP with an unknown Athlete ID does not reveal whether it
      exists (identical message).
- [ ] With `OTP_DEV_MODE=true` **and** a localhost origin, the OTP appears in the
      response; in production it is sent by SMS only.
- [ ] OTP lookups are rate-limited; repeated wrong codes are locked out.
- [ ] After verifying, only the athlete's own profile is shown (no PII leaks
      before verification).

**Payments**

- [ ] Successful test payment shows a receipt and marks the registration paid.
- [ ] Cancelled/failed payments leave the registration unpaid with a retry path.
- [ ] Replaying a webhook does not create duplicate payments.
- [ ] A tampered signature is rejected.
- [ ] Admin can mark a captured payment refunded; the status shows "refunded".
- [ ] Admin cannot mark a registration paid without a captured payment.

**Admin**

- [ ] Sign-in works; wrong credentials fail cleanly; sign-out works.
- [ ] A viewer account cannot see mutation buttons and gets `403` if it tries
      the API.
- [ ] Registrations: search, filters, sort, pagination and detail all work.
- [ ] Editing a profile/registration requires a reason and writes an audit entry.
- [ ] Categories/events with registrations cannot be deleted (advise
      deactivate).
- [ ] The last active owner cannot be demoted or disabled.
- [ ] Championships: create, edit, archive, add/edit/delete categories and
      events, and set fees and deadlines.
- [ ] Settings: organisation details and Athlete ID format save correctly.
- [ ] Audit trail shows the actions above.

**Exports**

- [ ] Filtered, all, per-championship and chosen-column exports download real
      `.xlsx` files.
- [ ] The export contains **all** matching rows, not just the visible page.
- [ ] Payment export works independently.
- [ ] Leading zeros are preserved (Athlete ID, bib); dates and currency are
      consistent; formulas cannot be injected (values starting with `=`, `+`,
      `-`, `@` are neutralised).

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "Backend not configured" | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing. Fill `.env` and restart. |
| "Administrator verification failed" on sign-in | The account is not in `admin_users`, or is disabled. Check the table and the account's role. |
| `OTP_NOT_CONFIGURED` | `SMS_PROVIDER` is `none`. Set `twilio`/`msg91` with credentials, or use `OTP_DEV_MODE=true` for localhost. |
| `PAYMENTS_NOT_CONFIGURED` | Razorpay keys are missing as function secrets. |
| `INVALID_SIGNATURE` on payment verify | Key secret mismatch between the app secret and Razorpay's key. |
| Webhook does nothing | Wrong URL or `RAZORPAY_WEBHOOK_SECRET` mismatch; check the function logs. |
| Exports are empty | No rows match the current filters, or you filtered to a championship with no registrations. |
| `INVALID_COLUMNS` on export | A column key chosen in the browser is not in the server registry. Reload the page to refresh the picker. |
| Photos/documents fail to upload | The `athlete-documents` bucket is missing — re-run the security migration. |
| CORS error | Add your site origin to `ALLOWED_ORIGINS` and redeploy the functions. |
| Admin login loops | Clear site data; the session may be stale. Sign in again at `/admin/login`. |

---

## Security notes

- Row Level Security is enabled on every table with **no public policies**;
  table privileges are revoked from `anon` and `authenticated`. The browser can
  only reach the data by calling Edge Functions.
- The **service-role key never leaves the server**. Only `VITE_`-prefixed
  variables are compiled into the browser bundle.
- OTP codes and passwords are never stored in plain text; OTPs and athlete
  session tokens are stored hashed and expire.
- Public endpoints are rate-limited (OTP requests, lookups, bootstrap).
- The returning-athlete flow never reveals whether an Athlete ID exists and
  never exposes PII before verification.
- Payment success is only ever granted after a server-side signature check or a
  verified webhook — never on the client's word.
- Administrative changes require a reason and are written to an audit trail.
- Privacy, terms and data-retention pages are included for the public site.

---

## Design decisions in plain English

- **Single authoritative creation path.** A `create_registration` database
  function builds each registration. It is the only way a registration is
  created, so eligibility, fees and numbers are always computed from the
  database — never from whatever the browser sent.
- **Registration ID = Bib Number.** One identifier is easier to explain to
  athletes and volunteers than two. The permanent **Athlete ID** stays separate
  and is never re-issued.
- **Money in paise.** All amounts are stored as integers (paise) to avoid
  floating-point rounding errors in fees and totals.
- **Bib numbers are derived, not configured.** The organiser does not pick a
  format. The bib encodes the athlete's sex (`M`/`W`) and the lower bound of
  their age bracket, followed by a sequence — `M4501`, `W4501`, and `W35101`
  for the 101st woman in the 35+ bracket. Each championship, sex and age
  category keeps its own counter, so a man and a woman of the same age each
  start from 01. A row lock plus a unique constraint means two athletes
  registering at the same instant cannot get the same number, and the number is
  never reused.
- **Refresh, don't duplicate.** If an athlete starts a registration but does not
  pay, coming back updates that same unpaid registration (keeping the bib)
  instead of creating a confusing second entry. A paid registration blocks
  duplicates.
- **Anonymous-and-safe profile checks.** To stop someone probing for athlete
  details, a duplicate-profile check requires the mobile number **and** date of
  birth, and the response is identical whether or not a match exists.
- **Server-side exports.** Excel files are built in the Edge Function from the
  full dataset, which keeps the browser light and guarantees the export matches
  the filters.
- **Exports are injection-safe.** Values that could be interpreted as formulas
  are prefixed so a malicious name cannot execute in Excel, and identifiers are
  written as text so leading zeros survive.
- **Honest "not configured" states.** If Razorpay or SMS are not configured, the
  API says so clearly instead of pretending, so nobody believes payments or OTPs
  are working when they are not.

---

## Project structure

```
athlete-registration-portal/
├─ src/                        # React frontend
│  ├─ components/
│  │  ├─ admin/                # PageHeader, StatCard, ExportBar
│  │  ├─ layout/               # PublicLayout, AdminLayout
│  │  ├─ registration/         # multi-step form + payment panel
│  │  └─ ui/                   # shadcn-style primitives
│  ├─ context/                 # Toast, Config, AdminAuth
│  ├─ hooks/                   # useDebouncedValue, useChampionshipOptions
│  ├─ lib/                     # api, types, format, validation, draft, export
│  └─ pages/
│     ├─ public/               # home, register, returning, status, receipt, policies
│     └─ admin/                # dashboard and all admin pages
├─ scripts/
│  └─ create-first-admin.mjs   # one-time owner creation
├─ supabase/
│  ├─ functions/               # Edge Functions (server logic)
│  └─ migrations/              # SQL schema, functions, security, aggregates
├─ .env.example
├─ vercel.json
└─ README.md
```

---

## License / usage

Internal project scaffold. Review the privacy, terms and retention text with your
organisation before publishing, and complete Razorpay merchant approval before
accepting live payments.
