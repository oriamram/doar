# פתקיות (notes)

Notes to yourself, on the same desk as Doar's mail. This is the most basic version: it is
here so there is something to look at and try before the app gets its real plan.

## What it does

- A pad ("פתק חדש"): pressing it tears off a fresh slip and puts it in your hand, ready to
  write on. On a PC the `n` key does the same.
- A note in hand comes up over the dimmed desk. Every letter is saved as it is written;
  "סיום" (or Esc, Ctrl+Enter, a press on the desk, the phone's Back) puts it back.
- Notes lie on the desk as yellow square slips, the one written on last first.
- "לפח" throws a note away; for six seconds a receipt offers "ביטול".
- Day and night follow the device.
- It installs as an app of its own (its own icon, opens with no connection).

## What it does not do yet, on purpose

- **No account and no server.** Notes are kept in the browser's own storage on the device
  they were written on (`pitkiyot:notes`), and nowhere else: not on the other device, and
  not after the browser's data for the site is cleared. Sign-in and keeping notes on
  Doar's server come with the real plan. (When they do: the app lives at its own address,
  so that address has to be added to the allowed redirect addresses in Supabase's
  sign-in settings, a one-line step for the owner.)
- No search, no colors, no reminders, no link to letters in Doar.

## Run it

From the repo's root:

```bash
npm install
npm run dev:notes        # http://localhost:5174
```

## Checks

```bash
npm run check -w notes                                  # types, lint, what can happen to a note
npm run build -w notes
npm run preview -w notes -- --port 4174 --strictPort    # in one terminal
npm run check:ui -w notes                               # in another: the screens, with a hidden browser
```

## Where things are

```
src/
  App.tsx          The desk: the pad, the slips, a note in hand, the receipt
  lib/notes.ts     What a note is and what can happen to it (pure functions)
  lib/store.ts     The copy kept on the device
  styles.css       The app's own look; the desk itself comes from packages/desk
scripts/
  check-notes.ts   Checks of lib/notes.ts
  check-ui.ts      Screen checks (the hidden browser in tools/browser.ts)
  make-icons.ts    Draws the icon and saves every size into public/ (npm run icons -w notes)
```

The look follows `DESIGN.md` at the repo's root: a note is the same yellow slip that Doar
clips to a letter.
