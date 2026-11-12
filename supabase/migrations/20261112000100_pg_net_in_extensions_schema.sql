-- pg_net was registered in the public schema; Supabase recommends keeping extensions out of it.
-- Its functions live in the "net" schema either way, so the timer's job is unchanged.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
