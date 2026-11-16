# Doar's home-screen widget (Android)

A small Android app whose only job is a widget: the newest letters in the inbox, on the
phone's home screen. Doar itself stays the web app installed from Chrome; a tap on the
widget opens Doar there.

## How it works

- **Connecting.** Settings in Doar, "ווידג׳ט במסך הבית", "חיבור הווידג׳ט". The server makes a
  random key and keeps only its SHA-256 (`widget_keys`). Doar opens
  `intent://connect?key=…#Intent;scheme=doarwidget;package=app.doar.widget;…`, which lands in
  `ConnectActivity`; it keeps the key and asks the phone to put the widget on the home screen.
  Without the app installed, Chrome downloads it instead (`/doar-widget.apk`).
- **Fetching.** `RefreshJob` asks the `postman` Edge Function `{ action: "widget", key }` and
  gets the newest letters (`supabase/functions/postman/widget.ts`). Android runs it every
  quarter of an hour (the shortest it allows); ↻ and connecting fetch at once.
- **Drawing.** `Render` draws from what `Store` keeps: a sheet with the letters, or, when the
  widget is made small, the number of new letters. Lists inside widgets without a service
  need Android 12, so the app needs Android 12 or newer.
- **Opening.** `OpenActivity` opens Doar's address (`/?thread=…`, `/?compose`, `/?widget`),
  sent straight to Doar as installed from Chrome (a "WebAPK") when it is there.
- **Disconnecting.** In Doar's settings. The next refresh gets "unknown widget", and the widget
  forgets its key and asks to be connected again.

## Building

```bash
npm run widget
```

Builds a release APK signed with this PC's debug key (so a newer build installs over the
older one) and copies it to `public/doar-widget.apk`, which the next deploy serves.
Needs the Android SDK (`ANDROID_HOME`) and a JDK 17 or newer.

## Checking on an emulator

The `Pixel_9_Pro_XL` emulator on this PC belongs to another project and is nearly full;
make a separate one instead (copy its `config.ini` without the data partition). Start it with
`-dns-server 8.8.8.8` (its own DNS resolves nothing here), install the APK with `adb install`,
and connect with
`adb shell am start -a android.intent.action.VIEW -d "doarwidget://connect?key=…"` using a key
made for the test (insert its SHA-256 into `widget_keys`, delete the row afterwards).
