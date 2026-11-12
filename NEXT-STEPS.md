# Doar: what needs you

Things only you can do (accounts, keys, your phone). Each one says what you get and
how long it takes. Nothing here is urgent; the app works without them.

## Quick ones

### 1. Send yourself one test email (1 minute)

Sending was built and checked through Gmail's Drafts, but no real email was sent from
your account without your OK.

1. Open Doar and tap **מכתב חדש**.
2. Put your own address in **אל**, write a word, tap the **שליחה** stamp.
3. Check that it arrives in your inbox.

### 2. Publish the Google app: done (12 November 2026)

The app is "In production", so anyone can sign in (up to 100 people) and Google no longer
signs you out every 7 days. Google shows "unverified app" at sign-in: click **Advanced**,
then continue. A sign-in made before publishing can still expire once; sign in again and it stays.

### 3. Make the site update by itself on every change (3 minutes)

Right now each update is deployed by hand.

1. Open https://vercel.com, the **doar** project, **Settings**, **Git**.
2. Click **Connect Git Repository**, choose GitHub, and allow Vercel to see `oriamram/doar`.
3. Tell Claude it's done.

### 4. Install Doar like an app

- **Phone:** in Edge, open the menu and choose **Add to phone**.
- **PC:** in Chrome or Edge, click the install icon in the address bar.

## Bigger features that need something from you

### 5. Notifications when Doar is closed

Today you get notified only while Doar is open (Settings, "התראה על דואר חדש").
For real push, Google must be allowed to tell us about new mail:

1. Open https://console.cloud.google.com/apis/library/pubsub.googleapis.com and click **Enable**.
2. Open https://console.cloud.google.com/cloudpubsub/topic/list, click **Create topic**, name it `doar-mail`.
3. On the topic, **Permissions**, **Add principal**: `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**.
4. Tell Claude. The rest (server part, keys) Claude builds.

### 6. Suggestions from your Google Contacts

Today the "To" box suggests people from your mail. To use your contacts too:

1. Open https://console.cloud.google.com/apis/library/people.googleapis.com and click **Enable**.
2. Tell Claude. You'll sign in to Doar once more to approve the new permission.

### 7. Gmail settings inside Doar (vacation auto-reply, filters, your Gmail signature)

Needs one more Google permission. Say "add Gmail settings"; you'll sign in once more.

### 8. AI features (summaries, suggested replies, smarter bundles)

1. Get an API key at https://console.anthropic.com.
2. In Supabase, open **Edge Functions**, **Secrets**, add `ANTHROPIC_API_KEY` with the key.
   Don't paste the key in chat.
3. Tell Claude what you want first.

### 9. The Android app (instead of the browser version)

1. On the phone, turn on **Wireless debugging**.
2. On the PC, run `npm run android:live`, or ask Claude to install a normal build.
   Claude can also point the app at the live site so it updates by itself.

### 10. Your own address (optional)

Buy a domain, add it in Vercel (**Settings**, **Domains**), and tell Claude, who adds it
to Supabase's allowed addresses.

## What Claude can build next without you

- Snooze a letter, and send later (Gmail's API has neither; a small server timer does it).
- Reading already-opened mail with no connection.
- Printing a letter, blocking a sender, calendar invitations.
- Not possible with today's permission: deleting forever (Gmail empties the trash after 30 days).
