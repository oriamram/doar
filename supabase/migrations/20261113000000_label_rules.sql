-- Automatic labels: mail from a certain sender gets a certain Gmail label.
-- The postman Edge Function applies these to new mail once a minute.
-- Server-only, like the other postman tables: RLS on, no policies.
create table public.label_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A full address ("dana@example.com") or a whole domain ("@example.com").
  match text not null,
  -- The Gmail label's id.
  label_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, match, label_id)
);

create index label_rules_user on public.label_rules (user_id);

alter table public.label_rules enable row level security;

revoke all on table public.label_rules from anon, authenticated;
