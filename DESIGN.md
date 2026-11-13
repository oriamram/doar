# Doar: design system

Doar ("דואר", mail) is a Gmail client that looks and behaves like a writing desk in a
post office. This file records what the design is made of and the rules it keeps, so
new screens stay in the same world.

## The idea

Everything sits on a **desk lit by a lamp**. Mail is real paper on it:

| Thing in the app | Object on the desk |
| --- | --- |
| An email in a list | An envelope, with the sender's stamp |
| An opened email | The envelope with its flap open and the letter slid out |
| Unread / read | Fresh paper with an airmail edge and a red seal / aged paper lying flat |
| Updates, promotions, social mail | A bundle of envelopes tied with twine |
| Filters | Paper luggage tags, punched at the end |
| Your labels | Strips of embossing-machine tape |
| Starred | A gold foil star sticker |
| Attached files | A steel paperclip on the envelope; photo prints and paper slips in the letter |
| Writing an email | A telegram form ("טופס 11"); Send is a stamp you stick on |
| Sending | The letter is sealed in an airmail envelope, stamped, and flies off |
| Checking for mail (phones) | Pulling the list down reveals a brass mail slot |
| Undo notes | A receipt torn off at the top |
| Sending later | A clock beside the Send stamp; the form "טופס 12 · מועד המשלוח" sets the time |
| A letter waiting for its time | A slip with a blue edge and a clock, in its own folder ("מתוזמנים") |
| Automatic labels | The form "טופס 9 · הוראות מיון": a sender, and the tape label its mail gets by itself |
| One-time suggestions (install, notifications) | A paper note with a blue edge at the top of the inbox |
| Settings and other forms | Printed forms with a form number |
| "New letter" | A blue airmail label |
| Your account | A red wax seal with your initial |
| Folders | A manila folder tab pulled out toward the mail |
| The logo and app icon | A fresh, unread letter: an airmail envelope sealed with red wax, a post horn pressed into the seal |

Stamps follow **Doar Ivri (1948)**, Israel's first stamps: a coin on a field of one
color, each value in its own color. Senders get one of seven such colors, always the same.

**The logo** is one photo-real picture of that envelope (`design/logo/envelope.png`, made
with an image model in a single take, 12 November 2026). Inside the app it lies straight on
the desk with a soft shadow; as an app icon it lies on a red card (`--ink-red`).
`python scripts/make-icons.py` rebuilds every size from it: web app icons, browser tab
icon, and the Android launcher icons. It carries no text, so it reads the same in any language.

## Rules (and where they come from)

1. **Realism is for showing what can be pressed.** Every object does what the real one
   would: tags filter, the stamp sends, the slot delivers. Nothing is decoration only.
   (Research on flat design: weak "this is clickable" cues cost users effort.)
2. **Text sits on plain paper.** Paper texture stays under 3% contrast; age is shown by
   paper color and darker edges, never by stains under text. (Studies of text on
   textured backgrounds: texture slows reading, and average contrast hides weak spots.)
3. **Dark ink on light paper, day and night.** Paper stays cream in the night theme, only
   dimmer, so letters are always dark-on-light, the easiest to read. Text written on the
   desk itself uses the `--text` colors.
4. **Contrast floor:** small text at least 4.5:1 on whatever it's written on; large or
   bold text and icons at least 3:1 (WCAG 2.2). The token values below were checked.
5. **Touch targets** are at least 40px, 44px for the main ones.
6. **Thumb zone on phones:** the main actions live at the bottom: new letter, reply
   tickets, undo notes.
7. **Motion answers an action and ends within half a second.** Opening a letter takes
   under 0.5s in total. The one longer moment is sending (1.3s), which never blocks.
   `prefers-reduced-motion` turns motion off.
8. **Everything destructive can be undone** for a few seconds (file, delete, spam, send).
9. **One light source:** top, slightly left. Shadows fall down; lifted paper has a
   longer shadow than paper lying flat.

## Tokens (see `src/styles/base.css`)

- Desk: `--desk`, `--desk-deep`, `--desk-raised`; text on it: `--text`, `--text-muted`, `--text-soft`.
- Paper: `--sheet` (fresh), `--sheet-aged` (read), `--sheet-letter`, `--sheet-lining`,
  `--manila`, `--kraft`, `--stamp-paper`.
- Ink on paper: `--ink`, `--ink-muted`, `--ink-faded`, `--ink-red`, `--ink-blue`.
- Brand colors: postal red `#a63a26`, airmail blue `#24407a`, ink navy `#1f2a3a`, cream `#fbf6ea`.
- Shadows: `--shadow-rest`, `--shadow-lift`, `--shadow-press`, `--shadow-float`.
- Type: Discovery (Light / Demibold / Black) for everything; Courier Prime for dates,
  addresses and form numbers.

## Voice

Short, plain Hebrew, in the post office's voice: "לתיוק", "מברק", "המכתב בדרך",
"ממיינים את הדואר…". Buttons say what happens. Errors say what went wrong and what to do.
Plural imperative ("משכו", "בחרו") instead of gendered forms.

## Tried and rejected

- Marks drawn over sender stamps in the list (cancellation waves, an X): confusing.
- Small text inside stamps.
- Heavy or blotchy paper texture and stains.
- Decorations that cover information (a postmark over the date).

## Sources

- Flat design and clickability: https://www.nngroup.com/articles/flat-design/
- Skeuomorphic vs flat, by age group (Oswald, 2018): https://flatisbad.com/publications/Oswald-HCI18.pdf
- Text on textured backgrounds (Scharff & Ahumada): https://www.laurenscharff.com/research/Oxford.html
- Thumb zone: https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users
- Animation timing: https://web.dev/articles/choosing-the-right-easing and https://valhead.com/?p=2978
- Dark mode and halation: https://www.boia.org/blog/dark-mode-can-improve-text-readability-but-not-for-everyone
- WCAG 2.2: https://w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Inbox bundles: https://uxdesign.cc/lessons-learnt-from-google-inbox-f79d670ddca5
- Doar Ivri stamps: https://www.collectorsclub.org/wp-content/uploads/2017/09/Doar_Ivri.pdf
- Airmail labels: https://wahsonline.com/category/air-mail-etiquettes
