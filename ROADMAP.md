# Doar: the roadmap

Written 13 November 2026, after a full review of the code, the server and the design.
The user-facing version of this plan (Hebrew, with pictures) is a published page; this
file is the working copy: what gets built, where, and how it is checked.

## Where Doar stands

Doar is a complete daily Gmail client on PC and phone: inbox, folders, labels, bundles,
search, reading in a sandbox, writing with formatting and files, drafts, undo, sending
later, automatic labels by sender, notifications on both devices, keyboard shortcuts,
swipes, install, share target, `mailto:` links.

What a daily user would still miss (found in the review):

| Missing today | Planned in |
| --- | --- |
| Bring a letter back later (snooze) | 1.1 |
| A reminder when nobody answered | 1.2 |
| Buttons on the notification itself | 1.3 |
| Quiet hours | 1.5 |
| Quoted text in long conversations is shown in full, again and again | 0.6 |
| Rename, recolor or delete a label | 0.6 |
| "You wrote 'attached' but attached nothing" | 0.6 |
| PDF opens only by downloading | 0.6 |
| All mail from one person in one tap | 2.3 |
| Block a sender | 2.2 |
| Reading opened mail with no connection; writing with no connection | 3.3 |
| Settings shared between phone and PC | 0.5 |
| Calendar invitations shown as invitations | 2.1 |
| Printing a letter | 3.8 |
| Vacation auto-reply, Gmail filters, aliases (need one more Google permission) | 5 |
| Deleting forever (needs a wider Google permission; Gmail empties the bin after 30 days) | not planned |

## The idea

Today Doar looks like a post office. The plan makes it work like one. Four workers
handle the mail before it reaches the desk, and the desk becomes a place where mail
gets finished instead of piling up.

| Part | In the app | What it takes off you |
| --- | --- | --- |
| The postman (הדוור) | Time | Mail arrives, returns and reminds at the right moment |
| The sorter (המיון) | Shape | Every letter looks like what it is and offers its one natural action |
| The inspector (הבודק) | Trust | Every letter is checked before you read it |
| The clerk (הפקיד) | Words | Summaries, replies written for you, answers from your mail (AI, optional) |
| The desk (השולחן) | The ritual | Open the day's mail one by one, finish, and see a clear desk |

Rules for everything below:

1. Nothing is added to the main screen unless it replaces something. A feature shows
   up where the need is (on the letter, on the notification), not as a new button.
2. Every object does what the real one would (DESIGN.md rule 1). New objects are listed
   in "New objects" below and get added to DESIGN.md when built.
3. Doar's server keeps no mail text. It keeps times, ids, rules and notes the user wrote.
4. The workers never do anything that can't be undone. No worker sends, deletes
   forever, or hides mail. Every automatic act is shown and can be reversed.
5. Phases 0 to 3 need no AI, no key and no money. The clerk is a layer on top.
6. Each phase ends live on https://doar-henna.vercel.app, tested, with a short report
   and an updated guide ("מדריך קצר").

## Phase 0: foundations and the gaps

Small, mostly invisible, and it makes every later phase safe to test.

**0.1 Demo mailbox.** `?demo=1` runs Doar on a built-in made-up mailbox with no
sign-in. One seam in `src/lib/gmail.ts` (`gmail()`), `src/lib/googleToken.ts` and
`src/lib/postman.ts` swaps the network for `src/demo/` fixtures: about 40
conversations covering every kind of mail in this plan, including a phishing sample.
Replaces the throwaway `__mock-sw.js` harness. Uses: automatic screen checks, my own
testing without the real mailbox, and showing Doar to friends.

**0.2 Fault reports.** `error` and `unhandledrejection` handlers and every failed
action report to `postman` (`report` action) into
`client_reports (id, user_id, at, app_version, place, message, detail jsonb)`.
No mail text: codes, statuses, and addresses of requests without their query. Kept 14
days by the nightly cleanup. Reason: on 13 November a browser call failed and nothing
recorded why.

**0.3 System status.** Settings gets "מצב המערכת": app version, when the server last
looked for mail (`mail_watch.updated_at`), each device's last delivered notification,
the last fault, and "שליחת דוח תקלה". If the server has not looked for 10 minutes the
inbox shows a note.

**0.4 One command for every check.** `npm run check`: types, lint,
`check-webpush`, `check-rules`, and a new `scripts/check-ui.ts` that walks the main
flows in the demo mailbox with hidden Edge. A GitHub Actions workflow runs it on push.

**0.5 Shared settings.** `user_prefs (user_id pk, data jsonb, updated_at)` on the
server, read and written through `postman`. Signature, undo time, bundles, swipe
choices, templates and the new settings in this plan follow the user to both devices.
Theme and sounds stay per device.

**0.6 The gaps.**
- Fold quoted text: `.gmail_quote`, `blockquote[type=cite]`, Outlook's reply block,
  and "On … wrote:" / "בתאריך … כתב/ה:" lines collapse behind a small "· · ·" tab
  (`EmailBody.tsx`).
- Labels: rename, recolor, delete (`labels.patch`, `labels.delete`) in the labels form.
- Forgotten attachment: the text says "מצורף", "מצרף", "attached" or "attachment"
  and nothing is attached, so Send asks first (`Compose.tsx`).
- PDF opens in a viewer (blob in a frame) with a download button (`Attachments.tsx`).
- Select everything in a list; mark a whole bundle as read.
- Recent searches under the search box.

**0.7 Close the open ends.** Confirm on the server that a real rule labels older mail
and that a real new letter gets its label from the timer. Ask the user whether
notifications appear on the phone's screen.

Needs the user: the answer about phone notifications; optionally NEXT-STEPS item 4
(automatic deploys).

## Phase 1: the postman, mail at the right time

All of it runs on the machinery that already works: the once-a-minute `tick` in
`supabase/functions/postman/index.ts`, Web Push, and the service worker.

**1.1 "דואר שמור" (held mail: bring it back later).**
- On a letter: a ticket "להחזיר אליי…", a swipe, and the `b` key. Form "טופס 14":
  this evening, tomorrow morning, the weekend, next week, another time.
- The letter leaves the inbox wearing a slip "שמור עד יום א׳ 8:00". A folder "שמורים"
  shows only while something is held.
- At its time it is back at the top, unread, with a blue strip "חזר מהדואר השמור",
  and a notification.
- Server: `reminders (id, user_id, kind 'hold' | 'reply', thread_id, after_message_id,
  due_at, status, created_at, done_at)`, `claim_due_reminders()` like
  `claim_due_sends()`. Due: `threads.modify` adds `INBOX` and `UNREAD`, then a push.
  A new message in a held conversation cancels the hold (Gmail returns it by itself).
- In Gmail's own apps a held letter is simply filed until it returns.

**1.2 "דואר רשום" (registered mail: tell me if nobody answers).**
- In the writing form, beside the clock: a registered label "R". Choose 1, 3 or 7 days.
- An answer arrives: the label comes off quietly. No answer: the sent letter returns
  to the inbox with "עדיין אין תשובה מ־… · 3 ימים" and a notification with
  "להזכיר שוב" and "לוותר". A folder "ממתינים לתשובה" shows while something waits.
- Server: `kind 'reply'` in the same table. Due: `threads.get?format=minimal`; any
  message later than the sent one without `SENT` means answered. Letters sent later
  carry `followup_days` in `scheduled_sends`, and the reminder is created on delivery.

**1.3 Buttons on the notification.** "לתיוק" and "נקרא" (Android shows two). The push
carries a signed ticket (HMAC over user, conversation and an expiry of 48 hours, with
a new `ticket_secret` in `server_keys`). `notificationclick` in `public/sw-extra.js`
posts the ticket to `postman` (`ticket` action), which needs no session. Reminder
notifications carry "להזכיר שוב מחר" and "לוותר".

**1.4 One-time codes in the notification.** The server spots a code in the subject or
preview (Hebrew and English patterns, in a small module shared by app and server) and
titles the notification with it: "קוד: 482 913", then the sender. Codes pass quiet
hours.

**1.5 "שעות פתיחה" (opening hours) and express senders.**
- Settings: from, to, days, "סגור בשבת". Outside the hours the server holds
  notifications and sends one summary at opening time. The mail itself still arrives.
- "אקספרס": a sender marked express always notifies at once and shows a red express
  strip. `sender_marks (id, user_id, match, mark 'express' | 'refused', created_at)`.
- `mail_watch` gets `hours jsonb`, `tz text`, `held_threads text[]` (ids only; the
  summary reads the headers again at opening time, so no mail text is stored).

**1.6 Notifications within seconds** (optional, NEXT-STEPS item 5): Gmail push through
Pub/Sub instead of the once-a-minute look.

Checks: unit checks for due times, opening hours and code patterns
(`scripts/check-postman.ts`); the push check extended with a button press; on the real
mailbox, a letter held for two minutes and a registered check on an existing sent
letter, both put back. The "an answer arrived" path needs two test emails to the
user's own address, which needs their OK.

## Phase 2: the sorter and the inspector

**2.1 Kinds of mail** (`kinds.ts`, shared by app and server). Detection goes from the
surest sign to the weakest; anything unsure stays a plain letter.

| Kind | Sign | Looks like | Its one action |
| --- | --- | --- | --- |
| Code | code pattern near "קוד", "אימות", "code", "OTP" | A queue ticket ("פתק תור") with the code in large digits; fades after 15 minutes | Copy |
| Parcel | carrier domains, tracking-number patterns, "משלוח", "חבילה", "נמסר" | A kraft "הודעה על דבר דואר" slip: carrier, status, number | Track |
| Receipt | "קבלה", "חשבונית", "receipt", "invoice" and an amount | Narrow receipt paper, the amount at its edge | To the spike |
| Invitation | a `text/calendar` part or an `.ics` file | A card with a date block | To the calendar |
| Leaflet | `List-Unsubscribe`, `Precedence: bulk` | A thin leaflet inside its bundle | Return to sender |
| Letter | everything else | The envelope, as today | Reply |

- The list request adds the `List-Unsubscribe` header (`LIST_HEADERS` in `gmail.ts`).
- "דוקרן הקבלות": receipts by month with a monthly sum.
- "זה לא קוד / חבילה / קבלה" on any shaped letter corrects it, and the correction is
  remembered per sender (in `user_prefs`).
- A strip at the top of the inbox while something is on its way: "2 חבילות בדרך".

**2.2 "החזר לשולח" (return to sender).** One stamp replaces the small unsubscribe
link. It unsubscribes the proper way (one-click `List-Unsubscribe-Post` sent from the
server, else the email request that exists today, else the list's page) and marks the
sender `refused`: their future mail goes straight to the bin, where Gmail keeps it 30
days. The letter gets a red "הוחזר לשולח" stamp. Undo for five seconds; refused
senders are listed in the sorting form and can be taken back. Works on a person too.

**2.3 The sender's card and the stamp album.**
- Tap a stamp or a name: a card with the address, their letters (`from:x OR to:x`),
  the files they sent, and the actions that belong to a person: write, express,
  automatic label, return to sender.
- "אלבום הבולים" in the menu: the people you write with as stamps on an album page,
  most frequent first. It is the address book (`contacts.ts` plus `recentRecipients`).

**2.4 The inspector** (`inspector.ts`; runs when a letter is opened, on the full
message Gmail already sends).
- Sender: Gmail's own verdict in `Authentication-Results`. An intact seal "השולח
  אומת" when DMARC passes; nothing when there is no verdict; a broken seal and a
  warning strip when DMARC fails, when the name shows one address and the letter
  comes from another, when the name is a well-known body and the domain is not theirs,
  or when the domain imitates one (mixed alphabets, one letter off).
- `known-senders.ts`: about 40 bodies often imitated in Israel (banks, Israel Post,
  couriers, tax and national insurance, payment apps, toll roads, utilities, health
  funds) with their real domains. It grows over time.
- Links: a tap on a link whose text names one site and whose target is another, an
  IP address, or a shortener inside a flagged letter shows a slip first: "הקישור
  מוביל אל … · לפתוח / לא לפתוח". Other links open as today.
- Tracking marks: 1×1 and hidden pictures and known tracking hosts (`trackers.ts`)
  are removed before the letter is shown, and counted: "הוסרו 2 סימני מעקב". Real
  pictures still load. This stops the common "did they open it" pixel, not every
  method; "להסתיר תמונות" stays for full protection.
- First letter from an address: a slip "מכתב ראשון מהכתובת הזאת".
- The inspector stamps. It never hides or deletes.

Checks: `scripts/check-kinds.ts` and `scripts/check-inspector.ts` over a corpus of
made-up Hebrew and English samples, including look-alikes that must not match; the
demo mailbox carries one of each kind; screen checks in both themes.

## Phase 3: the desk

**3.1 "פתיחת הדואר" (opening the mail).** With three or more unread letters, a tied
bundle sits at the top: "הדוור הביא 7 מכתבים · לפתוח אחד־אחד". One letter at a time,
already open, four tickets in the thumb zone: reply, file, bring back later, bin
(`r`, `e`, `b`, `#` on a keyboard). People first, then codes, parcels and receipts as
quick cards, then each bundle as one decision. The remaining pile shows at the side.
The end is the one long moment in the app: the last letter leaves, the lamp warms, and
a date stamp "אין דואר" lands on the blotter (1.2 s, never blocks, off with reduced
motion). Then the empty desk lists what returns tomorrow.

**3.2 "פתק" (a note on a letter).** A yellow slip clipped to the letter, a yellow
corner in the list. `notes (user_id, thread_id, text, updated_at)`. A held letter can
carry a note ("להתקשר אליו לפני").

**3.3 No connection.** IndexedDB (`src/lib/store.ts`) keeps the last 300 opened or
prefetched conversations and every list seen; letters open from it at once and refresh
behind. Writing with no connection puts the letter in "התיבה האדומה" with a slip
"ייאסף כשהרשת תחזור"; it goes out when the connection returns while Doar is open, or
the next time it opens. Filing, stars and read marks queue the same way. Cleared on
sign-out.

**3.4 "מגירת הקבצים" (the files drawer).** Every attached file as prints and slips,
newest first, by person or kind; a tap goes to its letter.

**3.5 Search in plain words.** Chips above the box: from whom (the stamp album), with
a file, when, where. They write the Gmail query underneath.

**3.6 On the PC.** Drag a letter onto a folder, a label or the bin. Right-click menu.
`Ctrl+K` "לאן?" for folders, labels, people and actions. The desk reaches the top of
the window (Window Controls Overlay). The split between list and letter can be
dragged. A new letter can open in its own window.

**3.7 On the phone.** A light buzz at swipe thresholds and stamp presses. Swipe
choices in Settings. Swipe between letters while reading. Text size (regular, large,
very large). Reading aloud with the phone's own voice. Optional lock with the phone's
fingerprint check when Doar opens (a lock on the screen, not encryption).

**3.8 Small objects, each replacing a plain control.** The lamp's chain switches day
and night. A postal scale in the writing form shows the weight of the files against
the limit. A signature written by hand, added under your letters as a picture. A pad
of ready-made replies ("נוסחים"). A clean print of a letter. The Hebrew date on the
postmark (a setting).

Checks: screen checks for the ritual from first letter to clear desk; the store
checked by cutting the network in hidden Edge; drag and drop and the palette by
keyboard and pointer events.

## Phase 4: the clerk (AI, optional)

Needs the user: an Anthropic API key entered in Supabase (NEXT-STEPS item 8) and a
monthly limit set in the Anthropic console.

Rules: the clerk reads and writes drafts. It never sends, files or deletes. It works
when asked. It shows the letters it relied on. Text inside a letter is treated as
material, never as instructions. The server stores no mail text and no answers;
results are kept on the device.

Build: Edge Function `supabase/functions/clerk` with the official SDK
(`npm:@anthropic-ai/sdk`), model `claude-opus-5-5`, adaptive thinking, low effort for
short jobs and medium for writing, streaming to the app, structured output for
extraction, prompt caching for the fixed instructions, refusal fallback on.
`clerk_usage (user_id, day, kind, calls, input_tokens, output_tokens)` feeds "כמה
עלה החודש" in Settings and a monthly ceiling enforced by the function.

- **4.1 "בקצרה".** On a long letter or conversation: a slip with one or two
  sentences, what is asked of you, and the dates and amounts in it. Three short
  suggested answers come with it.
- **4.2 "לכתוב בשבילי".** In a reply: one line, typed or dictated with the keyboard's
  microphone ("תגיד לה שכן, יום שלישי ב־10"), becomes a full letter in your voice on
  the form, for you to edit and send. A style card is built once from about 30 of your
  sent letters, with your OK. A setting says whether the clerk writes for you in the
  masculine or the feminine.
- **4.3 "מודיעין".** A question in the search box ("מתי הטיסה לאתונה?"). The clerk
  searches and reads with two read-only tools, answers in a paragraph, and lays the
  letters it used underneath. At most six steps.
- **4.4 "עיתון הבוקר".** At an hour you choose, a notification; opening it prints a
  front page: what needs you today, what arrives today, what returns today, and the
  rest in brief. Every headline opens its letter. Made when opened, stored nowhere.
- **4.5 Finer sorting.** Letters the rules can't shape with confidence get their kind
  and fields (amount, due date, tracking number, event time) from the clerk.
- **4.6 "תרגום".** A letter into Hebrew, or your reply into English, on a second sheet.

Cost (estimates from assumed lengths, to be measured in the first week): a summary
about 2 cents, a written reply about 3, a question about 10, a morning paper about 13,
on `claude-opus-5-5` ($4 and $20 per million tokens in and out). A month of five
summaries, three replies and one question a day plus the paper: about $12. The same on
`claude-sonnet-5-5` is about half; on `claude-haiku-5-5`, under $1. The model is the
user's choice after the measured week.

Checks: a fixed set of made-up letters with expected facts (dates, amounts, who asks
what); injection samples that must not change the clerk's behavior; cost per call
logged from `usage`.

## Phase 5: on request

- Notifications within seconds (Pub/Sub). The user enables one Google service.
- Gmail settings inside Doar: vacation reply as a sign on the door, Gmail's signature,
  aliases, Gmail's own filters. One more Google permission and one more sign-in.
- Google Contacts in the stamp album. The user enables one Google service.
- Calendar: answer an invitation from its card. One more permission.
- A native Android app: a home-screen widget, replying from the notification, no
  dependence on Chrome. Needs a Firebase project.
- A second mail account.
- Your own address for the site.
- Google's verification. Only worth it if Doar opens to the public; not recommended now.

## What stays out

- Telling you whether someone opened your letter. Doar removes such marks; it does not add them.
- A worker that sends or deletes by itself.
- Ads, analytics, or any third party except Google, and Anthropic if the clerk is on.
- Points, streaks, badges.

## New objects (to add to DESIGN.md as they are built)

| Thing | Object |
| --- | --- |
| A held letter | A slip with the return time; the folder "שמורים" |
| A letter awaiting an answer | The white registered label with a large "R" |
| A one-time code | A post-office queue ticket |
| A parcel on its way | The kraft "הודעה על דבר דואר" slip |
| A receipt | Receipt paper; the spike |
| An invitation | A card with a date block |
| A refused sender | The red "הוחזר לשולח" stamp with a pointing hand |
| A checked sender | A wax seal, intact or broken |
| The address book | A stamp album |
| A note | A yellow slip under a paperclip |
| The outbox | The red street mailbox |
| Day and night | The lamp's chain |
| The day's digest | A newspaper front page |
| The clerk's summary | A typed slip clipped to the letter |

Already taken, do not reuse: the telegram is the writing form ("טופס 11").
Form numbers in use: 4, 5, 7, 9, 11, 12, 14, 15, 16, 17, 18, נספח א׳, נספח ב׳, נספח ג׳.

## Risks

| Risk | Answer |
| --- | --- |
| A letter is given the wrong shape | Shapes need a strong sign; one tap corrects, and the correction sticks |
| The inspector warns about honest mail, or misses a fake | It stamps and never hides; wording says "ייתכן"; Gmail's spam filter stays the first line |
| More features, less simplicity | Rule 1 above; every part can be switched off in Settings; the guide gets one page per worker |
| The clerk gets something wrong | It only drafts and summarizes, always beside the original |
| A letter tells the clerk what to do | Read-only tools, no sending, letters passed as material |
| The clerk's cost runs away | Works on request; a ceiling in the function and in the Anthropic console; a counter in Settings |
| The server stops looking for mail | System status shows it; the app notes it after 10 minutes |
| Google's connection breaks (a changed password) | Exists today: one "sign in again" notification |
| Supabase or Vercel limits | Usage is far below the free limits; checked at each phase |

## Order

| Phase | What changes for the user | Needs the user |
| --- | --- | --- |
| 0 | The gaps closed; faults explain themselves | One answer about the phone |
| 1 | Mail returns on time; buttons and codes on notifications; quiet hours | OK for two test emails to themselves |
| 2 | The inbox in true shapes; return to sender; every letter checked | Nothing |
| 3 | The daily ritual and the clear desk; notes; no-connection; PC and phone polish | Nothing |
| 4 | The clerk | A key and a monthly limit |
| 5 | Extras | Per item |

Each phase is one stretch of work that ends deployed, with its checks passing and a
short report. NEXT-STEPS.md keeps the list of what only the user can do.

## Progress

Approved by the owner on 13 November 2026: phases 0 to 3. The clerk (phase 4) is left out for now.

**The guide (live, 14 November 2026).** Asked for by the owner after the names of phases
1 to 3 needed explaining: one place where anyone can read what Doar does, lightly. "מה
דואר יודע לעשות" (`src/lib/guide.ts`, `Guide.tsx`, `GuideArt.tsx`): 29 rows with pictures
and 23 one-line small things, in seven chapters by moment of use. It opens from the menu,
from "לאן?", from a one-time note at the top of the inbox, from the sign-in screen (for
people who have not signed in), and from the address `/?guide`. It replaces the old
"מדריך קצר", a numbered list of paragraphs. Every later feature adds its line there.

Fixed the same day, from the owner's phone: a receipt with a long subject pushed the
receipts spike off the left of the screen (any form could be widened by a long word; now
none can), the files drawer's slips kept a letter's narrow width, and the stamp album's
search line had no style of its own, so at night it took the device's dark look.
Also that day: the button on a receipt said "לדוקרן" but filed the letter, and the owner
asked why the letter closed with "המכתב תויק". It now says "כל הקבלות" and opens the
spike over the letter; filing stays with "לתיוק".
And two more, from a parking company's receipts abroad: (1) the letter was cut at its right
edge. It is a web page's markup pasted into an email, every box "100% wide plus padding", so
it is wider than whatever shows it, at any scale. Such a letter now gets back the one rule its
missing stylesheet had (padding counts inside the width), is laid out as if the letter were
440px wide and scaled down; a picture keeps a height it asks for, and a picture that cannot be
fetched is put away. (2) No sum was read: it was in kronur ("884 kr"), and only in the HTML.
Sums are now read in any common currency (signs, words, codes in capitals), with thousands
and cents written either way, and a receipt's total is read from what the reader sees
(`letterText`), on the receipt's card and for every row of the spike.

**The home-screen widget (16 November 2026).** The owner wanted to see mail from the
phone's home screen. Doar is a web app, and Android gives widgets only to installed apps, so
the widget is a small app of its own (`widget/`, plain Java, about 450 KB), downloaded from
Settings. It has no sign-in: "חיבור הווידג׳ט" makes a random key on the server (which keeps
only its SHA-256) and hands it to the widget app through a link; with it the widget can ask
the server for one thing, the newest letters in the inbox as Doar's desk shows them (who,
subject, when, unread, a one-time code). It looks every quarter of an hour (Android's
shortest), and ↻ looks at once. A tap on a letter opens it in Doar as installed from
Chrome. Settings list the connected widgets, each can be disconnected. Checked on an Android
emulator against the real mailbox, then the test key was deleted.

**Opening the mail as cards (16 November 2026).** The owner found the bundle step confusing
("do I have to decide all of them?") and asked for it "Tinder style". Every new letter is
now a card, bundled ones too (with their bundle's tag): swipe left to file, right to mark
read and keep, press to open the letter in full (Back returns to the cards). A letter is no
longer marked read just by being shown. Undo on "filed" brings the card back on top. Keys
on a PC: ← and →, Enter to open, Esc.
The same day the owner found it laggy on the phone. A trace with a dragged card showed the
browser painting the whole card again for every frame (its paper texture, blend and shadow);
the card now moves on a layer of its own and its stamps only fade. Painting during a drag
went from about 350 ms to 40 ms, and after letting go from about 410 ms to 85 ms.

**Copied codes go to the bin (15 November 2026).** Asked for by the owner: once a one-time
code is copied, its letter can go. Copying a code (queue ticket, list row, the card in the
letter) marks its letter on that device; a quarter of an hour later the app moves it to the
bin, with the usual undo note ("קוד שהעתקתם הועבר לאשפה"). A starred letter stays. It runs
while the app is open, or the next time it opens; nothing on the server. On by default,
with a switch in Settings ("קוד שהעתקתי עובר לאשפה").

**The server (done once, for phases 0 to 3).** Migration `20261113100000_post_office.sql`
and `postman` version 4 are live: fault reports, shared preferences, held and registered
mail, sender marks (express and refused), opening hours, notes, one-click unsubscribe,
and signed tickets for buttons on notifications. Checked: `scripts/check-postman.ts`
(codes, hours with sunset times, reminders, tickets), a Deno type check, and the
once-a-minute timer answering without errors after the deploy. Not yet exercised with a
real session: every new request from the app (the app's side arrives phase by phase).

**Phase 0 (live).** The demo mailbox (`?demo`), `npm run check` and `npm run check:ui`,
fault reports, system status in Settings, shared settings, quoted text folded, label
management (checked against Gmail itself with a temporary label), the forgotten-attachment
warning, PDFs opening inside Doar on a PC, select all, mark a bundle read, recent searches.
Found and fixed on the way: a shortcut key was also typed into the form it opened, and a
picture opened from a letter was trapped inside the letter's area instead of covering the
screen. Still open from 0.7: a real rule labeling older mail, and a real new letter labeled
by the timer (both wait for matching mail to arrive).

**Phase 1 (live).** Held mail (form 14, the hourglass, the folder "שמורים", `b`),
registered mail (form 15, the "R" beside Send, the folder "ממתינים לתשובה"), letters the
server brought back standing first under "חזרו אליך", buttons on notifications, codes in
the notification's title, opening hours with "סגור בשבת", and express senders.

Checked against the real mailbox on 13 November 2026, with two test letters to the owner's
own address (both in the bin afterwards, no reminder left behind):
- A registered letter nobody answered came back: `returned: 1` in the timer's report, the
  conversation in the inbox and unread, both devices accepted the notification.
- "להזכיר שוב" on that notification filed it again and made a new reminder of the same kind.
- A held letter came back at its time the same way; "לתיוק" took it out again.
- "נקרא" and "לתיוק" on a new-mail notification changed exactly those labels in Gmail.
- A letter scheduled with a registration was sent by the timer, and its reminder was made
  on delivery, pointing at the letter that was actually sent.
- A letter to oneself is not taken for an answer, and does not notify.

**Phase 2 (live).** Kinds of mail (`src/lib/kinds.ts`): a code is a queue ticket on the
counter at the top of the inbox, a parcel is a kraft delivery slip ("2 חבילות בדרך"), a
receipt is receipt paper with its sum, an invitation is a card that leads to the calendar,
list mail is a thin leaflet; "זה לא…" corrects, per sender, on every device. Return to
sender (the red stamp, five seconds to undo, then: the sender refused, the list asked to
stop, the letter binned). A sender's card (form 17) from the stamp on an envelope, the
stamp album, and the receipts spike (form 16). The inspector (`src/lib/inspector.ts`,
`known-senders.ts`): Gmail's own verdict as a wax seal, names of well-known bodies on
addresses that are not theirs, near-copies of well-known sites, links that lead elsewhere
than they say (asked about before they open; the wrapping that mail systems add is looked
through), tracking pictures taken out and counted, and a slip on a first letter from an
address. It all runs on the device; the server was not changed.

Checks: `scripts/check-kinds.ts` (about 60 samples, with look-alikes that must stay
letters), `scripts/check-inspector.ts` (about 70), and the screen checks walk every kind,
the correction, return to sender with undo and without, the card, the album and the spike.
On the real mailbox only one thing was asked: that the receipts search is understood by
Gmail (it is; a count came back, nothing was read). How the kinds and the inspector judge
real mail will show in daily use; every judgement has a one-press correction.

Left for later from the plan: the invitation's date in the list (it shows once the letter
is open), and a parcel's page when the letter gives no link.

**Phase 3 (live, in part).** Built and checked:
- 3.1 Opening the mail: the strip "הדוור הביא…", one open letter at a time with five
  answers (reply, file, later, bin, keep; `r`, `e`, `b`, `#`, space), people first, then
  codes, parcels and receipts, then each bundle as one decision, and the clear desk at the
  end (the lamp, the blotter, the date stamp, what returns tomorrow).
- 3.2 Notes: a yellow slip on a letter, kept by the server for every device, a yellow
  corner in the list, the `n` key.
- 3.3, the reading half: the letters of the last 300 opened conversations are kept on the
  device (`src/lib/store.ts`, IndexedDB), so they open at once and can be read with no
  connection; signing out empties it. Checked in a real browser: keeping, reading back,
  making room, emptying.
- 3.4 The files drawer (form 18), by kind.
- 3.5 Search chips that write pieces of the search and take them off.
- 3.6 On a PC: Ctrl+K "לאן?", a right-click menu on a letter, dragging letters onto a
  folder, a label or the bin.
- 3.7 On a phone: larger text in letters, reading a letter aloud.
- 3.8 The lamp's chain, the postal scale, a clean print of one letter, the Hebrew date
  beside a letter's date.

Not built yet (each is its own piece of work):
- 3.3 Writing with no connection ("התיבה האדומה"), and filing, stars and read marks made
  with no connection. Today these need a connection, as before.
- 3.6 The desk reaching the top of the window, a split that can be dragged, a new letter in
  its own window.
- 3.7 Swipe choices in Settings, swiping between letters, the fingerprint lock, a buzz on
  every stamp press (it buzzes on swipes, on "keep" and on return to sender).
- 3.8 A signature written by hand, and the pad of ready-made replies ("נוסחים").
- The files drawer by person, the "from whom" search chip, and a guide page per worker.

Not checked on real mail, because it needs mail from someone else to arrive: a code in a
notification's title, the summary at opening time, an express sender passing closed hours,
and an answer taking a registration off (all four are covered by `check-postman.ts` and
by the demo). The app's own requests (`hold-create`, `reply-create`, `hours-set`,
`mark-set`) run for the first time with a real session when the owner uses them; the
filter the server reads reminders with was checked for form against the live database.
