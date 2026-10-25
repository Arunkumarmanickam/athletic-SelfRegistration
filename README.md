# CDMAA Athletic Self Registration

A production-ready athlete registration portal for CDMAA championships. Built with React, TypeScript, Vite, Tailwind CSS, Supabase (Postgres, Auth, Edge Functions), and Cashfree (UPI-only) payments.

## Features

- **Draft-based flow** - Athletes are only created on successful payment. Nothing permanent is saved until verification.
- **Cashfree UPI-only payments** - Server-side order creation, verification via Cashfree API, redirect callback handling.
- **Application Number** - Generated before payment (`APP-YYYY-XXXXXX`), trackable independently of registration/bib.
- **Aadhaar verification** - Front side upload required before payment (validated, not stored).
- **Status tracking** - Lookup by Application Number + mobile, or Registration/Bib + mobile.
- **Admin panel** - Manage championships, registrations, athletes, payments, exports.
- **Unpaid application tracking** - Admins can review pending, failed, abandoned, and not-started submissions under **Registrations → Unpaid applications**. These rows show full athlete details but no Athlete ID or bib.
- **Receipts** - Auto-generated PDF receipt on successful payment.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS + React Router
- **Backend:** Supabase (Postgres, RLS, Edge Functions - Deno)
- **Payments:** Cashfree JS SDK v3
- **Storage/Auth:** Supabase

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
Create `.env` in root:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Supabase setup
- Run migrations from `supabase/migrations/`
- Deploy Edge Functions from `supabase/functions/`
- Set secrets: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` (`sandbox`|`production`), `SITE_URL`

### 4. Run dev server
```bash
npm run dev
```

### 5. Build
```bash
npm run build
```

## Registration Flow

1. Select championship → Fill personal details + events + Aadhaar upload
2. Draft created with Application Number → Redirect to payment
3. Pay via Cashfree UPI → Redirect to `/payment-callback` (verified server-side)
4. On success → Draft promoted via `promote_draft()`, registration/bib/athlete ID issued → Receipt shown
5. On pending/failed → Track via Application Number on Status page; admins can follow up under Registrations → Unpaid applications

## Admin: Unpaid Applications

Open **Registrations → Unpaid applications** (`/admin/registrations?tab=applications`) to see submissions that have not completed payment. These records come from `registration_drafts` and their `payment_orders`; they are not registrations.

| Status | Meaning |
| --- | --- |
| Pending payment | A gateway order exists and the application is still active, or the latest attempt is within the short grace window. |
| Payment failed | The latest gateway order was recorded as failed. |
| Abandoned | The application link expired without a verified payment. |
| Not paid | The form was saved but no payment attempt was started. |

This view is read-only. An application never has an Athlete ID, registration number, or bib number. `promote_draft()` creates those only after Cashfree reports the order as `PAID`, the amount matches, and the server verifies the payment. Terminal Cashfree failures are recorded by `payment-callback`; a checkout that never completes remains pending until the draft expires.

The Overview dashboard's registration counters still reflect confirmed registration rows. Use the **Unpaid applications** tab for unpaid attempts.

## TODO

- [ ] **Webhooks**: Add Cashfree webhook to auto-promote payments if user leaves before callback redirect
- [ ] **Email notifications**: Configure SMTP/provider for confirmation emails
- [ ] **Testing**: End-to-end testing for all payment states (success/pending/failed)
- [ ] **Production config**: Switch Cashfree from sandbox to production with live credentials
- [ ] **Admin improvements**: Add bulk actions and enhanced reporting
- [ ] **Mobile optimization**: Further UI tweaks for mobile payment flows

## Project Structure

```
src/                    # Frontend React app
supabase/functions/     # Edge Functions (Deno)
supabase/migrations/    # Database migrations
```

## License

Private - CDMAA Internal Use Only