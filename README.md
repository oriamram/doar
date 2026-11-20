# The desk: Doar and the apps beside it

One repo for several small apps that share a look, a server and their ways of working.
Each app is on its own (its own folder, build, checks and address); what they have in
common is kept once.

| App | Folder | Lives at | What it is |
| --- | --- | --- | --- |
| Doar ("דואר") | `apps/doar` | https://doar-henna.vercel.app | A Gmail client that looks and behaves like a writing desk in a post office. The first app, and by far the largest. |
| Notes ("פתקיות") | `apps/notes` | https://pitkiyot-phi.vercel.app | Notes to yourself on the same desk. Its most basic form: notes are kept on the device, there is no sign-in yet. |

## Layout

```
apps/
  doar/        The mail. Its README says how it is set up, run on a phone, and checked.
  notes/       The notes. Its README says what it does and what it leaves out on purpose.
packages/
  desk/        The look every app shares: the fonts, the tokens (colors of paper and ink,
               shadows), the desk itself and its lamp light. Plain CSS, imported as it is.
  core/        What every app does the same way. TypeScript, used as source (no build
               step). Today: keeping an installed app up to date.
supabase/      The one server behind the apps: tables (migrations/) and Edge Functions.
tools/         What every app's checks and deploys use: the hidden browser that walks the
               screens (browser.ts), and the runner of Vercel commands (vercel.mjs).
DESIGN.md      The design language every app keeps.
NEXT-STEPS.md  Things only the owner can do (accounts, keys, devices).
```

The repo is an npm workspace: one `npm install` at the root installs every app, and
`packages/*` are linked into `node_modules/@doar/`.

## Working on it

```bash
npm install          # once, at the root
npm run dev:doar     # http://localhost:5173
npm run dev:notes    # http://localhost:5174
npm run check        # every app's types, lint and logic checks, then lint of the shared folders
```

A command for one app: `npm run <script> -w doar` (or `-w notes`) from the root, or
`npm run <script>` inside the app's folder. The screen checks (`check:ui`) walk a built
app with a hidden browser; each app's README says how.

## The rules of the house

- **An app never imports from another app.** What two apps need moves to `packages/`,
  and only when the second app really needs it: nothing is shared on a guess.
- **Shared packages are source.** No build step and no versions: an app imports
  `@doar/desk/tokens.css` or `@doar/core/appUpdate.ts` and builds it with its own tools.
- **One server.** A new app adds its tables and functions under `supabase/`; the
  sign-in, the Google token and the notification plumbing are already there.
- **One look.** New screens stay in the world of `DESIGN.md`. An app's own stylesheet
  starts with `@import '@doar/desk/tokens.css'` and `@import '@doar/desk/base.css'`.
- **Pure parts are checked by scripts, screens by the hidden browser,** on the built
  app, before a deploy.

## Deploying

Each app is a Vercel project of its own (`doar`, and `pitkiyot` for the notes) with its
own address. A project's "Root Directory" setting on Vercel names its app's folder, and
the whole repo is uploaded, so the shared packages are there when the app is built.
Deploys are manual:

```bash
npm run deploy:doar
npm run deploy:notes
```

Both run `tools/vercel.mjs`, which can run any Vercel command for one app's project. A
deploy that should be looked at before it goes live:

```bash
node tools/vercel.mjs doar deploy --prod --skip-domain --yes    # builds, prints an address, the live site stays
node tools/vercel.mjs doar promote <that address> --yes         # now it is live
```

The Edge Functions are deployed separately (see `supabase/README.md`).

## Adding an app

1. Make `apps/<name>` from the notes app's skeleton: `package.json`, `vite.config.ts`,
   the three `tsconfig` files, `.oxlintrc.json`, `index.html`, `src/main.tsx`.
2. Give it its own ports in `vite.config.ts`, and add `dev:<name>` and `deploy:<name>`
   to the root `package.json`.
3. Create its Vercel project with Root Directory `apps/<name>`, and add it to the list
   at the top of `tools/vercel.mjs`.
4. Write its `README.md`, its checks (`scripts/`), and its rows in `DESIGN.md`.
