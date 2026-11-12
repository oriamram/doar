-- When someone switches notifications on and no other device of theirs had them on,
-- forget the old bookmark. The server then places a new one at "now", so the first
-- notifications are about mail that arrives from here on, not about mail that came
-- while notifications were off.
create function public.reset_mail_bookmark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.push_subscriptions
     where user_id = new.user_id and endpoint <> new.endpoint
  ) then
    update public.mail_watch set history_id = null where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_mail_bookmark() from public, anon, authenticated;

create trigger push_subscriptions_first_device
  after insert on public.push_subscriptions
  for each row execute function public.reset_mail_bookmark();
