-- The post office: what Doar's server keeps so that mail comes back on time, a
-- sender can be marked, notes stay with their letters, settings follow a person to
-- every device, and a failure on a device leaves a trace.
--
-- As before, none of these tables holds mail text. Every table is reachable only by
-- the Edge Functions (row level security on, no policies), and every row hangs off the
-- person's account, so erasing the account erases it all.

-- What went wrong on a device: where in the app, and the error's own words. Kept two weeks.
create table public.client_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  app_version text not null default '',
  device text not null default '',
  place text not null,
  message text not null,
  detail jsonb
);
create index client_reports_user_at on public.client_reports (user_id, at desc);

-- Preferences shared by a person's devices (signature, undo time, bundles…), as one JSON object.
create table public.user_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Held mail ("bring this conversation back at this time") and registered mail
-- ("tell me if nobody answered this sent letter by then").
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('hold', 'reply')),
  thread_id text not null,
  -- Registered mail: the sent message an answer is awaited to, and how many days were asked for.
  after_message_id text,
  days integer,
  due_at timestamptz not null,
  status text not null default 'waiting' check (status in ('waiting', 'working', 'returned', 'answered', 'cancelled', 'failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
-- One waiting reminder of each kind per conversation.
create unique index reminders_one_waiting on public.reminders (user_id, thread_id, kind) where status in ('waiting', 'working');
create index reminders_due on public.reminders (due_at) where status = 'waiting';
create index reminders_user on public.reminders (user_id, status);

-- What a person decided about a sender: always notify at once ("express"), or never
-- wanting their mail ("refused": it goes straight to the bin).
create table public.sender_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match text not null,
  mark text not null check (mark in ('express', 'refused')),
  created_at timestamptz not null default now(),
  unique (user_id, match, mark)
);

-- Notes a person writes on their own letters.
create table public.notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id text not null,
  text text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

alter table public.client_reports enable row level security;
alter table public.user_prefs enable row level security;
alter table public.reminders enable row level security;
alter table public.sender_marks enable row level security;
alter table public.notes enable row level security;

revoke all on table public.client_reports from anon, authenticated;
revoke all on table public.user_prefs from anon, authenticated;
revoke all on table public.reminders from anon, authenticated;
revoke all on table public.sender_marks from anon, authenticated;
revoke all on table public.notes from anon, authenticated;

-- Opening hours for notifications, and the conversations whose notifications wait for opening time (ids only).
alter table public.mail_watch
  add column hours jsonb,
  add column held_threads text[] not null default '{}';

-- A letter sent later can be registered too: the reminder is made when it goes out.
alter table public.scheduled_sends add column followup_days integer;

-- Take the reminders whose time has come, so that two overlapping timers never handle the same one.
create function public.claim_due_reminders()
returns setof public.reminders
language sql
security definer
set search_path = ''
as $$
  update public.reminders as r
     set status = 'working', attempts = r.attempts + 1
   where r.id in (
     select id from public.reminders
      where status = 'waiting' and due_at <= now()
      order by due_at
      limit 30
      for update skip locked
   )
  returning r.*;
$$;

revoke all on function public.claim_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;

-- The secret that signs the buttons on notifications. Made here, never shown to anyone.
insert into public.server_keys (name, value)
values ('ticket_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- The nightly tidy-up also drops old fault reports and finished reminders.
select cron.unschedule('postman-cleanup');
select cron.schedule('postman-cleanup', '17 3 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '2 days';
  delete from public.scheduled_sends where status = 'sent' and sent_at < now() - interval '14 days';
  delete from public.client_reports where at < now() - interval '14 days';
  delete from public.reminders where status not in ('waiting', 'working') and done_at < now() - interval '14 days';
$job$);
