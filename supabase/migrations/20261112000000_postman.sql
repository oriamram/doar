-- postman: scheduled sending and new-mail notifications (see supabase/functions/postman).
--
-- Every table here is for the server only: RLS is on with no policies, so the app's
-- publishable key can't read or write them. The postman Edge Function uses the secret key.
-- No mail is stored: only ids, times, and what a browser needs to receive a notification.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- Keys the server makes for itself: the timer's password and the notification signing keys.
create table public.server_keys (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

-- One row per browser that agreed to receive notifications.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

create index push_subscriptions_user on public.push_subscriptions (user_id);

-- Where the new-mail check stands for each person, and a short-lived Gmail access token.
create table public.mail_watch (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Gmail's bookmark: everything after it is new.
  history_id text,
  -- Which mail to notify about: all of it, everything but promotions and social, or personal mail only.
  scope text not null default 'important' check (scope in ('all', 'important', 'primary')),
  access_token text,
  access_expires_at timestamptz,
  -- Google refused our token; wait until the person signs in again.
  needs_reauth boolean not null default false,
  reauth_at timestamptz,
  -- A check in progress holds this, so two timers never notify about the same letter.
  checking_until timestamptz,
  updated_at timestamptz not null default now()
);

-- A letter waiting in Gmail's Drafts for its time. Only its ids are kept here.
create table public.scheduled_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  draft_id text not null,
  thread_id text,
  message_id text,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index scheduled_sends_due on public.scheduled_sends (send_at) where status = 'pending';
create index scheduled_sends_user on public.scheduled_sends (user_id);
-- A draft can wait for one time only.
create unique index scheduled_sends_one_per_draft on public.scheduled_sends (user_id, draft_id)
  where status in ('pending', 'sending');

alter table public.server_keys enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.mail_watch enable row level security;
alter table public.scheduled_sends enable row level security;

revoke all on table public.server_keys from anon, authenticated;
revoke all on table public.push_subscriptions from anon, authenticated;
revoke all on table public.mail_watch from anon, authenticated;
revoke all on table public.scheduled_sends from anon, authenticated;

-- Take the letters whose time has come, marking them "sending" in the same step,
-- so that two timers running at once can never both send the same letter.
create function public.claim_due_sends()
returns setof public.scheduled_sends
language sql
security definer
set search_path = ''
as $$
  update public.scheduled_sends as s
     set status = 'sending', attempts = s.attempts + 1, updated_at = now()
   where s.id in (
     select id from public.scheduled_sends
      where status = 'pending' and send_at <= now()
      order by send_at
      limit 20
      for update skip locked
   )
  returning s.*;
$$;

revoke all on function public.claim_due_sends() from public, anon, authenticated;
grant execute on function public.claim_due_sends() to service_role;

-- The timer proves who it is with a password made here, which never leaves the database.
insert into public.server_keys (name, value)
values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- Every minute: send what is due and look for new mail.
select cron.schedule(
  'postman-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://krdelzkqlisgmvdbqdru.supabase.co/functions/v1/postman',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.server_keys where name = 'cron_secret')
    ),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

-- Once a night: clear the timer's own log and letters sent long ago.
select cron.schedule(
  'postman-cleanup',
  '17 3 * * *',
  $job$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  delete from public.scheduled_sends where status = 'sent' and sent_at < now() - interval '14 days';
  $job$
);
