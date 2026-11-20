# The server

One Supabase project stands behind every app in this repo: the tables in `migrations/`
and the Edge Functions in `functions/`. An app that needs the server adds its tables
and functions here; sign-in, the Google token and the notification plumbing are shared.

- `functions/google-token`: keeps a person's Google refresh token and hands the apps
  short-lived access tokens.
- `functions/postman`: what Doar's server does while the app is closed (notifications,
  sending later, held and registered mail, the home-screen widget). Its pure parts
  (`codes.ts`, `hours.ts`, `rules.ts` and the like) are also imported by the Doar app
  itself, and checked by the scripts in `apps/doar/scripts/`.

All of it is Doar's so far. Paths written in the functions' comments (`src/…`,
`scripts/…`, `widget/`) are from Doar's folder, `apps/doar/`.

## Changing it

- Tables: a new file in `migrations/`, applied to the project.
- Functions: deployed by handing the project the files' contents as they are in the
  repo (JWT verification off: each function checks its caller itself). The repo's copy
  and the deployed copy are kept the same: after an edit here, deploy; never edit only
  the deployed one.
- Every table has row level security on. Tables that only the functions use have no
  policies at all.
