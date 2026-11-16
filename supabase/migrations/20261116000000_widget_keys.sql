-- Home-screen widgets on a person's Android phones (supabase/functions/postman/widget.ts).
--
-- A widget has no sign-in. Connecting one makes a random key that only the widget app
-- holds; this table keeps the key's SHA-256, never the key. The key lets the widget read
-- the latest letters in the inbox (who, subject, when) and nothing else. As with every
-- table here: row level security on, no policies (only the Edge Functions reach it), and
-- the rows hang off the account, so erasing the account erases them.

create table public.widget_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key_hash text not null unique,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index widget_keys_user on public.widget_keys (user_id);
alter table public.widget_keys enable row level security;
