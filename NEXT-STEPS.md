# Doar: what needs you

Things only you can do (your phone, your PC, your accounts). The first two take about
five minutes together and turn Doar into a real app on both devices.

## Do these once

### 1. Phone: install Doar through Chrome, and switch on notifications

1. Open **Chrome** on the phone (not Edge) and go to https://doar-henna.vercel.app
2. Sign in with Google.
3. Tap **התקנה** on the note at the top of the inbox (or ☰, then **התקנת האפליקציה**).
4. Open Doar from its new icon. Tap **הפעלה** on the notifications note, then **Allow**.
5. Check it: ☰, **הגדרות**, **שליחת התראת ניסיון**.

Why Chrome: Edge on Android agrees to notifications but never delivers them (a known
fault in that browser). You can keep browsing with Edge; only Doar itself runs on Chrome.

If notifications arrive late on the Samsung: phone Settings, Apps, Chrome, Battery, **Unrestricted**.

### 2. PC: install Doar through Edge, and switch on notifications

1. Open https://doar-henna.vercel.app in **Edge**.
2. Click **התקנה** (the note at the top, or **התקנת האפליקציה** in the sidebar).
3. Click **הפעלה** on the notifications note, then **Allow**.
4. Check it: **הגדרות**, **שליחת התראת ניסיון**.

Why Edge: it shows notifications even when it is closed. Chrome works too, but only while it is running.

The first time you click an email address on a web page, Windows asks which app should
open it. Choose Doar, and from then on such links open a new letter.

### 3. Phone: the widget on the home screen (5 minutes)

The newest letters on your home screen. Do it on the phone, in Chrome.

1. Open Doar, ☰, **הגדרות**, down to **ווידג׳ט במסך הבית**.
2. Tap **הורדת אפליקציית הווידג׳ט**. When the file has downloaded, tap it to open it.
3. Android asks whether Chrome may install apps: tap **הגדרות**, allow it, go back, tap
   **התקנה**. If Play Protect warns that it doesn't know the app, tap **פרטים נוספים**,
   then **להתקין בכל זאת** (it is Doar's own small app; it only shows the list).
   On a Samsung, if it says the installation was blocked, **Auto Blocker** is on: in the
   phone's Settings, **אבטחה ופרטיות**, **Auto Blocker**, switch it off, install, then
   switch it back on.
4. Back in Doar's settings, tap **חיבור הווידג׳ט**. The phone offers to put the widget on
   the home screen: tap **הוספה**. Hold it and drag a corner to make it as big as you like.
5. If the letters don't show within a minute, tap the arrow ↻ on the widget once.

## Done

- **Test emails (12 November 2026):** a regular letter and a scheduled one were sent to
  your own address and arrived.
- **Google app published (12 November 2026):** anyone can sign in (up to 100 people) and
  Google no longer signs you out every 7 days. Google shows "unverified app" at sign-in:
  click **Advanced**, then continue.

## Optional

### 4. Make the site update by itself on every change (3 minutes)

Right now each update is deployed by hand.

1. Open https://vercel.com, the **doar** project, **Settings**, **Git**.
2. Click **Connect Git Repository**, choose GitHub, and allow Vercel to see `oriamram/doar`.
3. Tell Claude it's done.

### 5. Notifications within seconds instead of within a minute

Today Doar's server looks for new mail once a minute. Gmail can tell it at once instead:

1. Open https://console.cloud.google.com/apis/library/pubsub.googleapis.com and click **Enable**.
2. Open https://console.cloud.google.com/cloudpubsub/topic/list, click **Create topic**, name it `doar-mail`.
3. On the topic, **Permissions**, **Add principal**: `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**.
4. Tell Claude. The rest Claude builds.

### 6. Suggestions from your Google Contacts

Today the "To" box suggests people from your mail. To use your contacts too:

1. Open https://console.cloud.google.com/apis/library/people.googleapis.com and click **Enable**.
2. Tell Claude. You'll sign in to Doar once more to approve the new permission.

### 7. Gmail settings inside Doar (vacation auto-reply, your Gmail signature)

Needs one more Google permission. Say "add Gmail settings"; you'll sign in once more.
(Automatic labels are already built in and need no extra permission: menu, **תיוג אוטומטי**.)

### 8. AI features (summaries, suggested replies, smarter bundles)

1. Get an API key at https://console.anthropic.com.
2. In Supabase, open **Edge Functions**, **Secrets**, add `ANTHROPIC_API_KEY` with the key.
   Don't paste the key in chat.
3. Tell Claude what you want first.

### 9. A fully native Android app

Only worth it if notifications through Chrome turn out unreliable on your phone. The
project already has the Android shell (Capacitor); native notifications need a Firebase
project, which takes you about ten minutes to create. Tell Claude and you'll get the steps.

### 10. Your own address

Buy a domain, add it in Vercel (**Settings**, **Domains**), and tell Claude, who adds it
to Supabase's allowed addresses.

## What comes next

The full plan is in ROADMAP.md (and as a page with pictures that Claude published for
you). Phases 0 to 3 were approved on 13 November 2026 and need nothing more from you:
you confirmed that notifications show on the phone, and allowed two test emails to your
own address.

Phases 0, 1 and 2 are live (two small leftovers of phase 2 are noted in ROADMAP.md).
Phase 3 is live in its main parts (opening the
mail one by one, notes, Ctrl+K, right click, dragging, the files drawer, reading with no
connection); what is not built yet is listed in ROADMAP.md under "Progress", and none of
it needs anything from you except saying which of them you want.

Every feature and every name is explained inside Doar, one line each with a picture: menu,
**מה דואר יודע לעשות**. To show it to someone who has no account yet, send them
https://doar-henna.vercel.app/?guide (it opens without signing in).

Worth trying once on your own mail, because only real mail can show it:
1. Open Doar when three or more new letters wait, and press "הדוור הביא…".
2. On a newsletter you don't want, press "החזר לשולח" (five seconds to change your mind).
3. If a letter is shown as the wrong kind (a parcel that isn't one), press "זה לא…" on
   its card. Doar remembers it for that sender.

The clerk (phase 4, AI) was left out for now. If you want it later: item 7 above, and a
monthly limit in the Anthropic console.

Not possible with today's permission: deleting forever (Gmail empties the trash after 30 days).
