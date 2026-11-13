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

## Done

- **Test emails (12 November 2026):** a regular letter and a scheduled one were sent to
  your own address and arrived.
- **Google app published (12 November 2026):** anyone can sign in (up to 100 people) and
  Google no longer signs you out every 7 days. Google shows "unverified app" at sign-in:
  click **Advanced**, then continue.

## Optional

### 3. Make the site update by itself on every change (3 minutes)

Right now each update is deployed by hand.

1. Open https://vercel.com, the **doar** project, **Settings**, **Git**.
2. Click **Connect Git Repository**, choose GitHub, and allow Vercel to see `oriamram/doar`.
3. Tell Claude it's done.

### 4. Notifications within seconds instead of within a minute

Today Doar's server looks for new mail once a minute. Gmail can tell it at once instead:

1. Open https://console.cloud.google.com/apis/library/pubsub.googleapis.com and click **Enable**.
2. Open https://console.cloud.google.com/cloudpubsub/topic/list, click **Create topic**, name it `doar-mail`.
3. On the topic, **Permissions**, **Add principal**: `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**.
4. Tell Claude. The rest Claude builds.

### 5. Suggestions from your Google Contacts

Today the "To" box suggests people from your mail. To use your contacts too:

1. Open https://console.cloud.google.com/apis/library/people.googleapis.com and click **Enable**.
2. Tell Claude. You'll sign in to Doar once more to approve the new permission.

### 6. Gmail settings inside Doar (vacation auto-reply, your Gmail signature)

Needs one more Google permission. Say "add Gmail settings"; you'll sign in once more.
(Automatic labels are already built in and need no extra permission: menu, **תיוג אוטומטי**.)

### 7. AI features (summaries, suggested replies, smarter bundles)

1. Get an API key at https://console.anthropic.com.
2. In Supabase, open **Edge Functions**, **Secrets**, add `ANTHROPIC_API_KEY` with the key.
   Don't paste the key in chat.
3. Tell Claude what you want first.

### 8. A fully native Android app

Only worth it if notifications through Chrome turn out unreliable on your phone. The
project already has the Android shell (Capacitor); native notifications need a Firebase
project, which takes you about ten minutes to create. Tell Claude and you'll get the steps.

### 9. Your own address

Buy a domain, add it in Vercel (**Settings**, **Domains**), and tell Claude, who adds it
to Supabase's allowed addresses.

## What Claude can build next without you

- Buttons on the notification itself (file, mark as read).
- Snooze a letter until later.
- Reading already-opened mail with no connection.
- Printing a letter, blocking a sender, calendar invitations.
- Not possible with today's permission: deleting forever (Gmail empties the trash after 30 days).
