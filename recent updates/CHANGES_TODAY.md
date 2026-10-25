# Changes - 25 October 2026

## Payment Flow (Cashfree UPI)
- Swapped Razorpay to Cashfree UPI-only across frontend and Edge Functions
- Updated `payment-retry` to create Cashfree orders with UPI-only restriction
- Updated `payment-callback` to verify via Cashfree API, promote drafts on success, pass Application Number/Mobile in redirects
- Updated `verify-payment`, `public-config`, `register` for Cashfree compatibility
- Added `src/lib/cashfree.ts` for Cashfree JS SDK integration
- Updated `PaymentPanel` to show Application Number and use Cashfree checkout

## Application Number Tracking
- Added migration `20261025000001_application_numbers.sql` for `application_numbers` sequence
- Updated `create_registration_draft` and `promote_draft` RPCs to generate `APP-YYYY-XXXXXX`
- Updated `register` and `payment-retry` to return Application Number
- Created `lookup-application-status` Edge Function
- Drafts trackable by Application Number even before registration is created

## Status Page Improvements
- Added lookup by Application Number (for drafts/pending payments) or by Registration/Bib (for confirmed)
- Auto-lookup when redirected from payment with Application Number + Mobile
- Persists last used Application Number and Mobile in localStorage
- Shows draft details with payment status (pending/processing/failed/paid)
- Better messaging for pending/failed payments
- Application Number displayed prominently

## UI/UX Fixes
- Added `ScrollToTop` component and scroll fixes on navigation/redirects
- Auto-scroll to top on form validation errors and after moving to payment
- Removed Download PDF, Print, Check Status buttons from receipt page (auto-download still works)
- Added "Quick Fill (Test)" button on registration page for testing

## Data Cleanup
- Cleared all test registered athlete data from live DB

## Documentation
- Updated `README.md` with current flow, features, setup, and TODO list

## Testing
- Build passing
- Tested UPI flow in sandbox
- Verified Application Number lookup for pending payments
