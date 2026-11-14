# Doar

A calmer, faster client for Gmail. It runs on PC and Android from one codebase.

- **App:** React + TypeScript + Vite
- **PC:** installable web app (PWA)
- **Android:** native app built with [Capacitor](https://capacitorjs.com)
- **Gestures:** `@use-gesture/react` + Motion, with haptics through `@capacitor/haptics`
- **Gmail:** Gmail REST API, called straight from the device
- **Backend:** Supabase: Google sign-in, plus the `google-token` Edge Function that keeps the Google refresh token server-side and hands the app short-lived access tokens
- **Planned:** compose/reply, search, push notifications, Claude-powered AI features

## Setup

1. Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key.
2. Supabase: apply `supabase/migrations/`, deploy `supabase/functions/google-token` (with JWT verification off; it checks the session itself), and add the Edge Function secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Google Cloud: enable the Gmail API, and create a **Web application** OAuth client with the redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`. While the app is in "Testing", add yourself as a test user.
4. Supabase Auth: enable the Google provider with that client, and allow the redirect URLs `http://localhost:5173` and `app.doar.mail://auth`.

## Run it on PC

```bash
npm install
npm run dev
```

Open http://localhost:5173.

To install it like an app, build it, serve the build, then use the install icon in Chrome or Edge's address bar:

```bash
npm run build
npm run preview
```

## Run it on Android

You need the Android SDK (comes with Android Studio). The Android app runs the same code in `src/` as the PC version.

### Connect your phone over Wi-Fi (no cable)

Needs Android 11 or newer, with the phone and PC on the same Wi-Fi.

1. **Turn on Developer options (once):** Settings → About phone → tap **Build number** 7 times.
2. **Turn on Wireless debugging:** Settings → System → Developer options → **Wireless debugging**. Tap **Allow** for this network.
3. On the PC, run:

   ```bash
   npm run android:pair
   ```

   - **Pair (first time only):** on the phone, tap **Pair device with pairing code**. Type the *IP address & Port* and the *6-digit code* from that popup.
   - **Connect:** type the *IP address & Port* shown on the main Wireless debugging screen. This is a different port from the popup.

After the phone restarts or rejoins Wi-Fi, run `npm run android:pair` again, press Enter to skip pairing, and type the new address.

**USB instead:** turn on **USB debugging** in Developer options, plug the phone in, and tap **Allow** on the prompt.

### Live reload (while developing)

```bash
npm run android:live
```

This installs a debug build of Doar on the phone that loads its screens from the dev server on your PC. Save a file and the phone updates instantly. Keep the phone connected, and press Ctrl+C to stop.

Afterwards, the app on the phone still points at your PC. Install a normal build to use it on its own.

### Normal build (works without the PC)

```bash
npm run android:install
```

This builds the web app, copies it into `android/`, and installs it on the connected phone. Other scripts:

- `npm run sync`: copy the latest web build into `android/` only
- `npm run android`: same as `sync`, then open Android Studio

The APK ends up in `android/app/build/outputs/apk/debug/app-debug.apk`, and you can also copy it to the phone and install it by hand.

## The demo mailbox

Open the app with `?demo` in the address (for example `http://localhost:5173/?demo`) to
run Doar on a made-up mailbox with no sign-in. The app above it is unchanged; only the
network is replaced by a stand-in for Gmail and for Doar's server that runs inside the
page (`src/demo/`). It is how the screens are tested without touching a real mailbox.

## Checks

```bash
npm run check        # types, lint, the server's pure parts (rules, encryption, codes, hours, tickets), kinds of mail, the inspector, the guide's lines
npm run build
npm run preview -- --port 4173 --strictPort    # in one terminal
npm run check:ui     # in another: walks the main screens in the demo mailbox with a hidden browser
node --experimental-strip-types scripts/check-push-e2e.ts    # notifications, end to end, with a real push service
```

`SITE=http://localhost:5173 npm run check:ui` checks the dev server instead, and
`SHOTS=some/folder` saves pictures of the screens it visits.

## Project layout

```
src/
  components/          The screens: Mailbox, ThreadList, ThreadView, Compose, the paper forms (Sheets)
  lib/
    gmail.ts           Gmail's API, straight from the device
    mailbox.ts         What's on screen and everything you can do to your mail
    postman.ts         The app's side of Doar's server
    settings.ts        Preferences; some follow you to every device
    report.ts          Fault reports (never mail text)
  demo/                The made-up mailbox behind "?demo"
  styles/              The writing desk (see DESIGN.md)
supabase/
  functions/postman/   Doar's server: notifications, sending later, held and registered mail, sender marks
  functions/google-token/
  migrations/
scripts/               Checks, icon builder, Android helpers
android/               Native Android shell (Capacitor)
```

## Where things are written down

- `DESIGN.md`: the design system and its rules.
- `ROADMAP.md`: what is being built, in phases, and what is already live.
- `NEXT-STEPS.md`: things only the owner can do (accounts, keys, devices).
