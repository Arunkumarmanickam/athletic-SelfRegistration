# CDMAA Athletic Self Registration

A production-ready athlete registration portal for CDMAA championships. Built with React, TypeScript, Vite, Tailwind CSS, Supabase (Postgres, Auth, Edge Functions), and PhonePe Payment Gateway (Standard Checkout).

## Features

- **Draft-based flow** — Athletes are only created on successful payment. Nothing permanent is saved until verification.
- **PhonePe payments** — Server-side order creation, hosted checkout, order-status verification, and redirect callback handling.
- **Application Number** — Generated before payment (`APP-YYYY-XXXXXX`) and trackable independently of the registration/bib.
- **Status tracking** — Lookup by Application Number + mobile, or Registration/Bib + mobile.
- **Championship configuration** — Per-championship age categories, events, fees, registration windows, and a per-athlete event cap.
- **Per-gender event eligibility** — Each event can expose different age categories to men and women.
- **Live event eligibility in the form** — The event picker marks events the athlete cannot enter and shows why.
- **Admin panel** — Manage championships, events, categories, registrations, athletes, payments, and exports.
- **Unpaid application tracking** — Admins can review pending, failed, abandoned, and not-started submissions under **Registrations → Unpaid applications**. These rows show full athlete details but no Athlete ID or bib.
- **Receipts** — Auto-generated JPEG receipt on successful payment (filename `CDMAA-<registration number>.jpg`). Auto-downloads once per tab after payment; re-downloadable from **Retrieve your details** and from **Admin → Athletes → [athlete]**.
- **Editable authority name** — The signing authority printed on receipts is configurable under **Admin → Settings** ("Authority name on receipts") and defaults to `Coimbatore District Masters Athletic Association`.
- **Configurable registration fields** — Per championship, admins can relabel, hide, or make optional the built-in fields, and add their own custom text/dropdown/radio/checkbox fields.
- **Returning athlete lookup** — Athletes can enter an existing Athlete ID on the registration form to prefill name, date of birth, gender, and mobile, then review and pay. New athletes use the same form unchanged.
- **Flexible athlete names** — Any full name is accepted except a purely numeric value; periods and other punctuation are preserved.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS + React Router
- **Backend:** Supabase (Postgres, RLS, Edge Functions — Deno)
- **Payments:** PhonePe Payment Gateway — Standard Checkout (hosted redirect)
- **Storage/Auth:** Supabase

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in real values. See that file for the full annotated list.

Frontend (compiled into the browser bundle):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_PUBLIC_KEY
VITE_SITE_URL=http://localhost:5173
```

Server-only (set as Supabase Edge Function secrets, never in frontend code):

```env
SUPABASE_SERVICE_ROLE_KEY=...
PHONEPE_CLIENT_ID=...
PHONEPE_CLIENT_SECRET=...
PHONEPE_CLIENT_VERSION=...
PHONEPE_ENV=sandbox             # sandbox | production
PHONEPE_WEBHOOK_USERNAME=...    # optional webhook auth (see below)
PHONEPE_WEBHOOK_PASSWORD=...
SITE_URL=http://localhost:5173  # public site URL used after payment
ALLOWED_ORIGINS=http://localhost:5173
BOOTSTRAP_ADMIN_SECRET=...      # one-time, only for the first admin
RESEND_API_KEY=                 # optional email receipts
NOTIFICATION_FROM_EMAIL=Registrations <registrations@example.com>
```

`PHONEPE_ENV` defaults to `sandbox`. Keep it on sandbox until the live merchant account is connected. `SITE_URL` and `ALLOWED_ORIGINS` must be updated to the production domain when deploying.

### 3. Supabase setup

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy
```

Then set the server-only secrets:

```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=... \
  PHONEPE_CLIENT_ID=... \
  PHONEPE_CLIENT_SECRET=... \
  PHONEPE_CLIENT_VERSION=... \
  PHONEPE_ENV=sandbox \
  SITE_URL=http://localhost:5173 \
  ALLOWED_ORIGINS=http://localhost:5173
```

- Migrations live in `supabase/migrations/` and are applied in filename order.
- Edge Functions live in `supabase/functions/` (one folder per function).
- The first (owner) administrator is created with `BOOTSTRAP_ADMIN_SECRET` via `npm run create-admin -- --email owner@example.org --name "Owner"`, then that secret should be removed.
- Additional admins are created from the admin panel.

### 4. Run the dev server

```bash
npm run dev
```

### 5. Build

```bash
npm run build
```

The build runs `tsc --noEmit` before Vite, so type errors fail the build.

## Registration Flow

1. Select a championship → either fill in the form as a **new athlete**, or choose **I have an Athlete ID** to fetch and confirm saved basics (name, DOB, gender, mobile). Pick the age category and this championship's events, then add contact details.
2. A draft is created with an Application Number → redirect to payment.
3. Pay on PhonePe's hosted checkout → the browser returns to `payment-callback` (verified server-side).
4. On success → the draft is promoted via `promote_draft()`, and the registration, bib, and Athlete ID are issued → receipt shown.
5. On pending/failed → track via Application Number on the Status page; admins can follow up under **Registrations → Unpaid applications**.

## Payments (PhonePe)

The portal uses **PhonePe Payment Gateway — Standard Checkout**. The server creates the order, the browser is redirected to PhonePe's hosted checkout, and the payment is only confirmed by asking PhonePe for the order status.

**Flow**

1. `register` stages a draft (no order, no athlete profile, no bib).
2. `payment-retry` calls PhonePe `POST /checkout/v2/pay` with the server-calculated fee (amount in paise, 30-minute expiry) and returns the hosted `redirectUrl`.
3. The browser navigates to that URL (`src/lib/phonepe.ts` re-checks the host is `phonepe.com`).
4. PhonePe returns the browser to `payment-callback?order_id=<merchantOrderId>`.
5. `payment-callback` calls `GET /checkout/v2/order/{merchantOrderId}/status?details=true`. Only a `COMPLETED` order with a matching amount is captured; `markPaymentCaptured()` promotes the draft.
6. `payment-webhook` handles the same events out-of-band, so a payment still completes if the athlete closes the tab before the redirect.

**Payment methods shown at checkout**

`createPhonePeOrder()` sends a `paymentModeConfig` (schema V2) that allows **UPI only**:

```json
{ "type": "UPI", "flows": ["INTENT", "QR"] }
```

Cards, net banking and wallets are not listed, so PhonePe does not offer them.

- **Mobile** — `INTENT` makes the page list the installed UPI apps (PhonePe, GPay, Paytm, BHIM, …) with the fee already filled in. Paying in the app returns the browser to `payment-callback`, which verifies the order server-side.
- **Desktop** — there is no app to launch, so the same UPI rail is presented as a QR code to scan with a phone.

If PhonePe's account-level settings have UPI Intent switched off, the hosted page falls back to QR-only; ask PhonePe to enable UPI Intent for the merchant.

If the account rejects the mode configuration with `400`, `createPhonePeOrder()` retries once without it (logged as a warning) so a payment is never blocked by it.

**Credentials**

| Variable | Where to get it |
| --- | --- |
| `PHONEPE_CLIENT_ID` | PhonePe dashboard → Developer settings |
| `PHONEPE_CLIENT_SECRET` | PhonePe dashboard → Developer settings |
| `PHONEPE_CLIENT_VERSION` | PhonePe dashboard → Developer settings |
| `PHONEPE_ENV` | `sandbox` or `production` |

Secrets never reach the browser. Never commit them or paste them into chat/issues.

**Webhook (recommended)**

- URL: `https://<project-ref>.supabase.co/functions/v1/payment-webhook`
- Auth: PhonePe's SHA scheme. Set the same username/password in the PhonePe dashboard and in `PHONEPE_WEBHOOK_USERNAME` / `PHONEPE_WEBHOOK_PASSWORD`.
- Events: `checkout.order.completed`, `checkout.order.failed`, `pg.refund.completed`, `pg.refund.failed`.
- Without these two secrets the webhook returns `503`; the browser callback still works.

**Database names**

The `payment_orders` / `payments` columns are still named `razorpay_order_id` and `razorpay_payment_id`. They now hold the PhonePe **merchant order id** and **transaction id** respectively; the names are kept to avoid a destructive migration.

## Championships & Events

Each championship owns its own age categories and events. Nothing is hard-coded per championship; the configuration lives in the database and is editable from **Admin → Championships**.

### Per-gender age eligibility

Every event has two eligibility lists:

- `male_category_ids` — age categories open to men.
- `female_category_ids` — age categories open to women.

Rules:

| Configuration | Effect |
| --- | --- |
| List is `null` or empty | The event is open to every category for that gender. |
| List has entries | Only the listed categories are eligible for that gender. |
| Both lists are `null` | Falls back to the legacy shared `category_ids` list. |

The event's `gender` field (`any`, `male`, `female`) is applied first, then the gender-specific category list. The server re-checks both rules in `create_registration_draft()`, so a crafted request cannot bypass the UI.

Age ranges use the **lower bound of each bracket**. For example, `30+ to 85+` includes every bracket from `30+` through `85–89`, and `90+` includes `90–94` (up to the championship's highest category).

### Event picker behaviour

- Events are sorted with eligible events first; ineligible events are grouped below a **“Not eligible for your selection”** divider.
- Ineligible events are disabled, shown with an amber background and a **“Not eligible”** badge, and explain the reason (“Not open to your gender” or “Not offered in your category”).
- An event fee is shown only when the event actually has a fee configured. Events without an event fee show no fee text.
- When the championship has a per-athlete event cap, the picker enforces it and explains how to swap a selected event.

### Admin event management

Open **Admin → Championships → Events** for the selected championship.

The editor supports:

- Event name, gender (`Any`, `Men`, `Women`), and fee (₹).
- Separate **Men's age categories** and **Women's age categories** checklists. Leaving a checklist completely unchecked means “all categories for that gender”.
- An **Active** flag. Inactive events remain in the admin list (marked `(inactive)`) but are not selectable by athletes.
- Editing an event preserves its existing order; changing a name or eligibility list does not reset `sort_order`.
- Deleting an event is blocked once registrations reference it — deactivate it instead.

### `state-meet-2026` programme

The live championship is `state-meet-2026` (44th Coimbatore District Masters Athletic Championship — 2026).

- **Status:** open for registration.
- **Event date:** 22 November 2026.
- **Registration window:** 20 October 2026 16:30 UTC → 19 November 2026 13:02 UTC.
- **Age categories:** 15 brackets, `30+` through `100+`.
- **Event cap:** 3 events per athlete.
- **Base fee:** ₹500 (category and event fees are added on top).

The programme has **18 active events**:

`100m`, `200m`, `400m`, `800m`, `1500m`, `5k Walking`, `110m Hurdles`, `100m Hurdles`, `80m Hurdles`, `400m Hurdles`, `300m Hurdles`, `Long Jump`, `Triple Jump`, `High Jump`, `Shot Put`, `Discus Throw`, `Javelin Throw`, `Hammer Throw`.

It also has **4 inactive extras** — `3000m`, `3000m Race Walk`, `10000m`, and `5000m`. They are not part of the current programme but can be enabled from the admin Events editor if needed.

`110m Hurdles` is men-only. `100m Hurdles` is open to both genders. All other events use the per-gender ranges below (shown as the first and last eligible bracket):

| Event | Men | Women |
| --- | --- | --- |
| 100m | 30+ – 85+ | 30+ – 90+ |
| 200m | 30+ – 85+ | 30+ – 80+ |
| 400m | 30+ – 80+ | 30+ – 60+ |
| 800m | 30+ – 80+ | 30+ – 60+ |
| 1500m | 30+ – 80+ | 30+ – 60+ |
| 5000m | 30+ – 80+ | 30+ – 60+ |
| 5k Walking | 30+ – 80+ | 30+ – 60+ |
| 110m Hurdles | 30+ – 45+ | — |
| 100m Hurdles | 50+ – 65+ | 30+ – 35+ |
| 80m Hurdles | 70+ – 75+ | 40+ – 60+ |
| 400m Hurdles | 30+ – 55+ | 30+ – 45+ |
| 300m Hurdles | 60+ – 75+ | 50+ – 65+ |
| Long Jump | 30+ – 85+ | 30+ – 80+ |
| Triple Jump | 30+ – 75+ | 30+ – 80+ |
| High Jump | 30+ – 75+ | 30+ – 80+ |
| Shot Put | 30+ – 85+ | 30+ – 80+ |
| Discus Throw | 30+ – 85+ | 30+ – 80+ |
| Javelin Throw | 30+ – 85+ | 30+ – 80+ |
| Hammer Throw | 30+ – 85+ | 30+ – 80+ |

These ranges apply only to `state-meet-2026`. The standard defaults (`default_categories`, `default_events`) and other championships are unchanged.

## Registration Form Fields

Open **Admin → Championships → [championship]** to configure both built-in and custom fields. Settings are stored per championship in `form_config` and in the `championship_registration_fields` table; the public form and the `register` function both honour them.

### Default registration fields

**Default registration fields** card lets an organiser, for each built-in field:

- **Rename** it — the new label is what athletes see.
- **Show / hide** it.
- Make it **required or optional**.

| Field | Rename | Hide | Make optional |
| --- | --- | --- | --- |
| Full name, Date of birth | Yes | No | No |
| Gender, Mobile number, Email, Representing (academy / district / state), Events | Yes | Yes | Yes |

An unchecked **Required** removes the `*` and the validation on the athlete form; the public form, the `register` function and `create_registration_draft` all read the same setting, so an admin-saved `required: false` is honoured end to end. Full name and date of birth stay visible and required because age categories and athlete identity depend on them.

When **Gender** is optional and left blank, the athlete is stored as `other` and is not restricted to gender-specific categories/events. When **Mobile number** is optional, a blank number is stored as-is — those athletes cannot be looked up by mobile, and duplicate detection falls back to name + date of birth. When **Events** are optional, an athlete may register without selecting an event. Older championships using the legacy `require_email` flag are carried forward automatically. The migration `20261122000001_configurable_required_fields.sql` updates the draft RPC.

### Free entry / base-fee waiver by age category

In the **Age categories** card, each category has two fee controls:

- **Free entry — waive base, category and event fees**: total becomes ₹0. Registration is confirmed immediately with no PhonePe payment (gateway rejects amounts below ₹1). Applies to that category (make separate male/female categories if only one gender should get it).
- **Waive championship base fee for this category**: waives only the championship base fee for that category; **category fee and event fees still apply**. Useful for cases like “100+ pays only ₹300 category fee”.

Only one waiver mode should be used at a time; if **Free entry** is checked, base-fee waiver is disabled.

The public form/receipt show the waived base fee accordingly. Stored on `championship_categories.is_free`, `championship_categories.waive_base_fee` (and defaults) by migrations `20261122000002_free_entry_categories.sql` and `20261123000001_category_waive_base_fee.sql`.

The admin **Dashboard** includes a **Free entries** stat card and a **Free** column in the “By championship” table. The **Championships** list shows `X free` per championship when present. Free registrations are counted as `fee_paise = 0`; paid registrations are counted as `payment_status = 'paid' AND fee_paise > 0`. Migration `20261122000003_dashboard_free_entries.sql` updates `get_dashboard_stats()`.

Deploy order for these fee-waiver changes: apply migrations, then redeploy `admin-championships`, `public-config`, and `register` (and any confirmation-loading functions if needed). See [Deployment](#deployment).

### Custom registration fields

**Custom registration fields** card adds extra questions to a championship's form:

- Field types: **text**, **dropdown**, **radio buttons**, and **checkboxes**.
- The organiser fixes the options for choice fields and marks each field mandatory or optional.
- Keys must match `^[a-z0-9_]+$`; answers are stored in the registration's `personal` JSONB so they survive into drafts, receipts and exports.
- Fields are staged locally while creating a new championship and saved together with it.
- Deleting a field is blocked once the championship has registrations — deactivate/hide it instead where appropriate.

The migration `20261103000001_championship_registration_fields.sql` creates the table and is applied with `supabase db push`.

### Returning athlete lookup

Returning-athlete prefill is **off by default**. Enable it in **Admin → Settings → Registration form → Allow returning athletes to fetch details by Athlete ID**.

When enabled, the top of the registration form shows a **"Have you registered with us before?"** toggle:

- **New athlete** — the normal form.
- **I have an Athlete ID** — the athlete enters their ID and clicks **Fetch my details**. Name, date of birth, gender and mobile are prefilled from the saved profile for review; all four are editable, and **Use a different athlete** resets them. Representing, email, custom fields and this championship's events still follow the admin configuration above.

The `fetch-athlete-basics` Edge Function backs this:

- Requires `site.enable_athlete_lookup = true` in `app_settings`; otherwise returns `403 FEATURE_DISABLED`.
- Returns **only** `full_name`, `date_of_birth`, `gender`, `mobile_country_code`, `mobile_number` and the Athlete ID — no email, address, history or session.
- Rate limited per IP (20/hour) and per Athlete ID (5/hour); the same generic error is returned for unknown and malformed IDs so IDs cannot be enumerated.
- No token is issued. Athlete IDs are still issued only after payment; when the athlete pays, `promote_draft()` reuses the existing profile by mobile + DOB, so no duplicate ID is created. The existing "already registered for this championship" guard still applies.

## Admin: Unpaid Applications

Open **Registrations → Unpaid applications** (`/admin/registrations?tab=applications`) to see submissions that have not completed payment. These records come from `registration_drafts` and their `payment_orders`; they are not registrations.

| Status | Meaning |
| --- | --- |
| Pending payment | A gateway order exists and the application is still active, or the latest attempt is within the short grace window. |
| Payment failed | The latest gateway order was recorded as failed. |
| Abandoned | The application link expired without a verified payment. |
| Not paid | The form was saved but no payment attempt was started. |

This view is read-only. An application never has an Athlete ID, registration number, or bib number. `promote_draft()` creates those only after PhonePe reports the order as `COMPLETED`, the amount matches, and the server verifies the payment. Terminal PhonePe failures are recorded by `payment-callback`; a checkout that never completes remains pending until the draft expires.

The Overview dashboard's registration counters reflect confirmed registration rows only. Use the **Unpaid applications** tab for unpaid attempts.

## Database & Migrations

Migrations are applied in filename order. Recent ones relevant to the current championship setup:

- `20261020000001_remove_relay_events.sql` — removes relay events.
- `20261020000003_registration_drafts.sql` — draft storage and expiry.
- `20261020000004_draft_functions.sql` — draft creation and promotion functions.
- `20261025000001_application_numbers.sql` — application number sequence and generation.
- `20261025000002_district_level.sql` — level-aware required fields and draft validation.
- `20261101000001_event_gender_categories.sql` — per-gender event eligibility, server-side validation, and the `state-meet-2026` event programme.
- `20261101000002_state_meet_100m_hurdles.sql` — opens `100m Hurdles` to both genders.
- `20261101000003_site_organizer_name.sql` — configurable organiser name in `app_settings` (`site` key).
- `20261102000001_site_authority_name.sql` — configurable receipt authority name in `app_settings` (`site` key), backfilled with `Coimbatore District Masters Athletic Association`.
- `20261103000001_championship_registration_fields.sql` — per-championship custom registration fields table.

The `state-meet-2026` programme migration is data-only for that championship. It does not alter the standard defaults or other championships. Default/custom field settings and the returning-athlete lookup require no migration — field settings live in `form_config`, and the lookup is a read-only Edge Function over the existing `athlete_profiles` table.

## Operations

- **Resetting test data:** the October 2026 cleanup was a one-off manual operation, not a migration. It removed athletes, registrations, drafts, payments, audit logs, sessions, tokens, and rate-limit rows, and reset `id_sequences` and `application_number_seq`. Admin accounts and championship configuration were kept. The next real application starts at `APP-2026-000001`, and the next athlete ID/bib starts at `000001`.
- **Audit logs:** cleared during that reset. New admin actions continue to be recorded.
- **Registration:** intentionally left open for `state-meet-2026`.

## Deployment

- Frontend is deployed on Vercel from the `main` branch; `vercel.json` contains the SPA rewrite.
- A push to `main` triggers a production build automatically. A README-only change does not alter the frontend bundle.
- Edge Functions are deployed separately:

```bash
supabase functions deploy public-config
supabase functions deploy admin-championships
supabase functions deploy register
supabase functions deploy fetch-athlete-basics
# ...or deploy every function
supabase functions deploy
```

`admin-championships` must be redeployed after changing field configuration logic, `register` after changing validation, and `public-config` after changing which columns the athlete form reads. `fetch-athlete-basics` is a new function that must be deployed once before the returning-athlete lookup works. For free-entry categories, deploy the migration first, then `admin-championships`, `public-config` and `register`; a zero-fee draft is promoted by `register` without a PhonePe order. The frontend (which includes the Settings and Championships UI) deploys automatically from `main` on Vercel.

- Secrets take effect immediately and do not require a function redeploy.
- `VITE_*` values are baked in at build time. After changing one in Vercel, trigger a new deployment.

## Project Structure

```
src/                    # Frontend React app
  components/           # UI and registration components
  pages/                # Public and admin pages
  lib/                  # API clients, types, formatting
public/brand/           # Association logo assets (header, login, receipt)
supabase/functions/     # Edge Functions (Deno)
supabase/migrations/    # Database migrations
scripts/                # Admin bootstrap helpers
```

## TODO

See `TODO.md` for the full handoff and production checklist. Open items include:

- [ ] **PhonePe webhook**: configure the SHA username/password so payments auto-promote when the athlete leaves before the callback redirect
- [ ] **Email notifications**: configure Resend for confirmation emails
- [ ] **Testing**: end-to-end coverage for all payment states (success/pending/failed)
- [ ] **Production config**: switch PhonePe from sandbox to production with live credentials
- [ ] **Admin improvements**: bulk actions and enhanced reporting
- [ ] **Mobile optimization**: further UI tweaks for mobile payment flows

## License

Private — CDMAA Internal Use Only
