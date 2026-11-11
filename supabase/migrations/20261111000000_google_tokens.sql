-- Google OAuth refresh tokens, one per user.
-- Only the google-token Edge Function (using the secret key) reads or writes this
-- table. RLS is on with no policies, so the app's publishable key can't touch it.
create table public.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

revoke all on table public.google_tokens from anon, authenticated;
