-- ---------------------------------------------------------------------------
-- Receipt hand-off tokens
--
-- Razorpay's callback URL must receive a POST request, which a static Vercel
-- site cannot answer (it returns 405). Redirect-based payments (net banking,
-- bank UPI apps) therefore POST to the `payment-callback` Edge Function, which
-- verifies the signature server-side and then redirects the browser to
-- /registration/success.
--
-- The confirmation cannot travel in a redirect: it is too large for a URL and
-- sessionStorage belongs to another tab. Instead the function stores a
-- single-use, short-lived token and puts only that token in the redirect. The
-- site exchanges the token once for the same confirmation payload
-- `verify-payment` returns.
--
-- Only the hash is stored, so a leaked database row cannot be replayed.
-- ---------------------------------------------------------------------------
create table if not exists public.receipt_tokens (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  registration_id uuid not null references public.registrations (id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  consumed_at     timestamptz
);

create index if not exists receipt_tokens_registration_idx
  on public.receipt_tokens (registration_id);

create index if not exists receipt_tokens_expires_idx
  on public.receipt_tokens (expires_at);

-- Housekeeping: drop tokens that are consumed or long expired so the table
-- cannot grow without bound.
create or replace function public.prune_receipt_tokens()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.receipt_tokens
  where consumed_at is not null
     or expires_at < now() - interval '1 day';
$$;

grant execute on function public.prune_receipt_tokens() to service_role;

-- No client access: the Edge Functions use the service role.
alter table public.receipt_tokens enable row level security;
