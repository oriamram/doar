import { DEMO_ME } from '../lib/demo'
import { bytesToBase64 } from '../lib/mime'

/**
 * The made-up mailbox behind "?demo": about forty conversations that cover every
 * kind of mail Doar treats differently. All names and addresses are invented, and
 * every address ends in ".example", which can never be a real site.
 */

export type Header = { name: string; value: string }

/** One part of an email, in the shape Gmail's API returns. */
export type Part = {
  mimeType: string
  filename?: string
  headers: Header[]
  body: { data?: string; size: number; attachmentId?: string }
  parts?: Part[]
}

export type DemoMessage = {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  /** Milliseconds since 1970. */
  internalDate: number
  historyId: number
  payload: Part
  /** Everything searchable, in lower case. */
  search: string
}

export type DemoLabel = { id: string; name: string; type: 'user' | 'system'; color?: { backgroundColor: string; textColor: string } }

export type DemoMailbox = { messages: DemoMessage[]; labels: DemoLabel[]; files: Map<string, string> }

type Person = { name: string; email: string }

const encoder = new TextEncoder()

export const toUrl64 = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const text64 = (text: string) => toUrl64(bytesToBase64(encoder.encode(text)))

export const plainText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/(div|p|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()

export const address = (person: Person) => (person.name ? `${person.name} <${person.email}>` : person.email)

const size64 = (data: string) => Math.floor((data.length * 3) / 4)

// ---------- People ----------

const me = DEMO_ME
const dana = { name: 'דנה לוי', email: 'dana@levi.example' }
const yonatan = { name: 'יונתן כהן', email: 'yonatan@shiputzim.example' }
const ima = { name: 'אמא', email: 'ruth.mizrahi@family.example' }
const noa = { name: 'נועה ברק', email: 'noa.barak@friends.example' }
const shai = { name: 'שי אברהם, רו״ח', email: 'shai@avraham-cpa.example' }
/** Never answers (see server.ts), so a letter to her stays without a reply. */
const michal = { name: 'מיכל שרון', email: 'michal@quiet.example' }
const sarah = { name: 'Sarah Miller', email: 'sarah.miller@devconf.example' }
const roi = { name: 'רועי שגב', email: 'roi@segev-team.example' }
const omer = { name: 'עומר דהן', email: 'omer.dahan@friends.example' }
const tamar = { name: 'תמר גולן', email: 'tamar@golan-design.example' }
const avi = { name: 'אבי פרץ', email: 'avi.peretz@work.example' }
const liat = { name: 'ליאת רוזן', email: 'liat@rozen-law.example' }
const teacher = { name: 'המורה של יובל', email: 'kita-gimel@school.example' }
const bank = { name: 'בנק הדוגמה', email: 'no-reply@bank-dugma.example' }
const courier = { name: 'שליחויות זריז', email: 'updates@zariz-delivery.example' }
const globalPost = { name: 'Global Post', email: 'tracking@globalpost.example' }
const books = { name: 'חנות הספרים', email: 'orders@sfarim-shop.example' }
const electric = { name: 'חברת החשמל לדוגמה', email: 'bills@hashmal-dugma.example' }
const cloud = { name: 'ענן הקבצים', email: 'security@anan-files.example' }
const shoes = { name: 'חנות הנעליים', email: 'news@naalayim.example' }
const club = { name: 'מועדון הלקוחות', email: 'club@moadon.example' }
const flights = { name: 'אתר הטיסות', email: 'deals@tisot.example' }
const weekly = { name: 'השבועון הטכנולוגי', email: 'editor@shvuon-tech.example' }
const friends = { name: 'רשת חברים', email: 'notify@reshet-haverim.example' }
const gan = { name: 'קבוצת הורי הגן', email: 'gan-shoshana@groups.example' }
const vaad = { name: 'ועד הבית', email: 'vaad@rehov-hagefen.example' }
const lottery = { name: 'הגרלת הזהב', email: 'winner@hagralat-zahav.example' }
/** Pretends to be the bank; its address is not the bank's. */
const fakeBank = { name: 'בנק הדוגמה', email: 'security@bank-dugma-login.example' }
/** Writes the way shops abroad do: a long name, a long subject, a long file name, all in Latin letters. */
const park = { name: 'Northern Glacier National Park Visitor Services', email: 'receipts@glacier-park.example' }

// ---------- Small files ----------

/** A one-page PDF with a few lines of text, built with correct offsets so any reader opens it. */
function tinyPdf(lines: string[]): string {
  const text = lines.map((line, index) => `${index === 0 ? '40 230 Td' : '0 -34 Td'} (${line.replace(/[()\\]/g, '\\$&')}) Tj`).join(' ')
  const stream = `BT /F1 20 Tf ${text} ET`
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 460 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<</Root 1 0 R/Size ${objects.length + 1}>>\nstartxref\n${xref}\n%%EOF\n`
  return toUrl64(btoa(pdf))
}

/** A small picture drawn on the spot, standing in for a photo. */
function photo(hue: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 320
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const sky = ctx.createLinearGradient(0, 0, 0, 320)
  sky.addColorStop(0, `hsl(${hue} 70% 78%)`)
  sky.addColorStop(1, `hsl(${hue + 40} 60% 60%)`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 480, 320)
  ctx.fillStyle = 'rgba(255, 244, 200, 0.9)'
  ctx.beginPath()
  ctx.arc(370, 90, 42, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `hsl(${hue + 90} 35% 32%)`
  ctx.beginPath()
  ctx.moveTo(0, 320)
  ctx.lineTo(0, 230)
  ctx.quadraticCurveTo(120, 150, 240, 220)
  ctx.quadraticCurveTo(360, 280, 480, 200)
  ctx.lineTo(480, 320)
  ctx.fill()
  return toUrl64(canvas.toDataURL('image/jpeg', 0.72).split(',')[1] ?? '')
}

// ---------- Letters ----------

type FileSpec = { filename: string; mimeType: string; data: string; contentId?: string }

type Spec = {
  thread: string
  from: Person
  to?: Person[]
  cc?: Person[]
  subject: string
  /** Minutes before now. */
  ago: number
  html: string
  labels: string[]
  headers?: Record<string, string>
  files?: FileSpec[]
  /** An invitation: the text of an .ics file. */
  calendar?: string
  /** What Gmail concluded about the sender; mail from "me" has no verdict. */
  auth?: 'pass' | 'fail' | 'none'
}

const PERSONAL = 'CATEGORY_PERSONAL'
const UPDATES = 'CATEGORY_UPDATES'
const PROMOTIONS = 'CATEGORY_PROMOTIONS'
const SOCIAL = 'CATEGORY_SOCIAL'
const FORUMS = 'CATEGORY_FORUMS'

const L_BILLS = 'Label_1'
const L_WORK = 'Label_2'
const L_FAMILY = 'Label_3'
const L_HOME = 'Label_4'

const rtl = (...lines: string[]) => `<div dir="rtl">${lines.join('<br>')}</div>`
const ltr = (...lines: string[]) => `<div dir="ltr">${lines.join('<br>')}</div>`

/** A reply with the earlier letter quoted under it, the way Gmail writes it. */
const reply = (text: string, quotedFrom: Person, when: string, quoted: string) =>
  `${text}<br><div class="gmail_quote"><div dir="rtl" class="gmail_attr">בתאריך ${when}, מאת ${quotedFrom.name} &lt;${quotedFrom.email}&gt;:</div>` +
  `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${quoted}</blockquote></div>`

/** A promotional email the way shops build them: a fixed 600px table, a banner, and a tracking picture. */
const promo = (color: string, title: string, lines: string[], site: string) =>
  `<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;font-family:Arial,sans-serif" dir="rtl">` +
  `<tr><td style="background:${color};color:#fff;padding:28px 24px;font-size:28px;font-weight:bold">${title}</td></tr>` +
  `<tr><td style="padding:22px 24px;font-size:16px;line-height:1.7;color:#222">${lines.join('<br>')}` +
  `<br><br><a href="https://${site}/sale" style="background:${color};color:#fff;padding:12px 22px;text-decoration:none;border-radius:4px;display:inline-block">לכל המבצעים</a></td></tr>` +
  `<tr><td style="padding:16px 24px;font-size:12px;color:#888">קיבלת את המייל הזה כי נרשמת לרשימת התפוצה. <a href="https://${site}/unsubscribe?u=4821">הסרה</a></td></tr></table>` +
  `<img src="https://track.${site}/open.gif?u=4821&m=77" width="1" height="1" alt="" style="display:none">`

function invitation(start: Date): string {
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const end = new Date(start.getTime() + 3_600_000)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Doar demo//HE',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:demo-team-meeting@doar.example',
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    'SUMMARY:ישיבת צוות',
    'LOCATION:חדר ישיבות 2',
    `ORGANIZER;CN=${roi.name}:mailto:${roi.email}`,
    `ATTENDEE;CN=${me.name};RSVP=TRUE:mailto:${me.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

function specs(): Spec[] {
  const meeting = new Date()
  meeting.setDate(meeting.getDate() + 3)
  meeting.setHours(10, 0, 0, 0)

  const trip1 = rtl('היי, חשבתי על סוף השבוע של ה־21. ניסע לצפון? יש צימר פנוי בראש פינה.')
  const trip2 = rtl('נשמע מעולה. אני יכולה לצאת ביום חמישי אחרי העבודה. כמה זה עולה ללילה?')
  const trip3 = rtl('650 ללילה, כולל ארוחת בוקר. צריך לסגור עד יום ראשון.')
  const trip4 = rtl('סגרתי. שלחתי מקדמה של 300. את מביאה את הציוד לטיול?')
  const trip5 = rtl('כן, יש לי הכל. רק תזכיר לי להביא את המפה של שביל הגולן.', 'מחכה כבר!')

  const list: Spec[] = [
    {
      thread: 't-code',
      from: bank,
      subject: 'קוד האימות שלך: 482913',
      ago: 3,
      html: rtl('שלום,', 'קוד האימות שלך לכניסה לחשבון הוא <b>482913</b>.', 'הקוד בתוקף ל־10 דקות. אם לא ביקשת קוד, אפשר להתעלם מההודעה הזאת.'),
      labels: ['INBOX', 'UNREAD', UPDATES],
    },
    {
      thread: 't-dana',
      from: dana,
      subject: 'אישור פגישה ביום שלישי',
      ago: 18,
      html: rtl('היי,', 'רציתי לוודא שיום שלישי ב־10:00 עדיין מתאים לך. אם כן, אשלח זימון עוד היום.', 'ואם אפשר, תביא בבקשה את החוזה החתום.', '', 'דנה'),
      labels: ['INBOX', 'UNREAD', PERSONAL],
    },
    {
      thread: 't-quote',
      from: yonatan,
      subject: 'הצעת מחיר לשיפוץ המטבח',
      ago: 130,
      html: rtl('שלום,', 'מצרף את הצעת המחיר כפי שסיכמנו בביקור. ההצעה בתוקף ל־14 יום.', 'אשמח לשמוע מה דעתך.', '', 'יונתן כהן, שיפוצים'),
      labels: ['INBOX', 'UNREAD', PERSONAL],
      files: [{ filename: 'הצעת-מחיר-מטבח.pdf', mimeType: 'application/pdf', data: tinyPdf(['Kitchen renovation quote', 'Cabinets and worktop: 31,000 NIS', 'Plumbing and electricity: 17,500 NIS', 'Total: 48,500 NIS']) }],
    },
    {
      thread: 't-parcel',
      from: courier,
      subject: 'החבילה שלך ממתינה לאיסוף',
      ago: 200,
      html: rtl(
        'שלום,',
        'חבילה מספר <b>RR123456789IL</b> הגיעה לנקודת האיסוף: דואר שכונתי, רחוב הגפן 12.',
        'אפשר לאסוף אותה עד 20.11, בהצגת תעודה מזהה.',
        '<a href="https://zariz-delivery.example/track/RR123456789IL">מעקב אחר המשלוח</a>',
      ),
      labels: ['INBOX', 'UNREAD', UPDATES],
    },
    {
      thread: 't-shoes',
      from: shoes,
      subject: 'מבצעי סוף העונה: עד 50% על הכל',
      ago: 240,
      html: promo('#b3261e', 'מבצעי סוף העונה', ['עד 50% הנחה על כל הקולקציה.', 'רק עד יום שישי, או עד גמר המלאי.'], 'naalayim.example'),
      labels: ['INBOX', 'UNREAD', PROMOTIONS],
      headers: {
        'List-Unsubscribe': '<https://naalayim.example/unsubscribe?u=4821>, <mailto:unsubscribe@naalayim.example?subject=unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        Precedence: 'bulk',
      },
    },
    {
      thread: 't-photos',
      from: ima,
      subject: 'תמונות מהשבת',
      ago: 300,
      html: rtl('היי חמוד,', 'מצרפת שתי תמונות מהטיול בשבת. יצא יפה, לא?', 'תתקשר כשיש לך רגע.', '', 'אמא'),
      labels: ['INBOX', PERSONAL, L_FAMILY],
      files: [
        { filename: 'שקיעה-בכנרת.jpg', mimeType: 'image/jpeg', data: photo(20) },
        { filename: 'הר-ארבל.jpg', mimeType: 'image/jpeg', data: photo(190) },
      ],
    },
    { thread: 't-trip', from: noa, subject: 'תכנון הטיול לצפון', ago: 2900, html: trip1, labels: [PERSONAL] },
    { thread: 't-trip', from: me, to: [noa], subject: 'Re: תכנון הטיול לצפון', ago: 2700, html: reply(trip2, noa, 'יום ג׳, 10 בנוב׳ 2026', trip1), labels: ['SENT'] },
    { thread: 't-trip', from: noa, subject: 'Re: תכנון הטיול לצפון', ago: 1600, html: reply(trip3, me, 'יום ג׳, 10 בנוב׳ 2026', reply(trip2, noa, 'יום ג׳, 10 בנוב׳ 2026', trip1)), labels: [PERSONAL] },
    {
      thread: 't-trip',
      from: me,
      to: [noa],
      subject: 'Re: תכנון הטיול לצפון',
      ago: 900,
      html: reply(trip4, noa, 'יום ד׳, 11 בנוב׳ 2026', reply(trip3, me, 'יום ג׳, 10 בנוב׳ 2026', trip2)),
      labels: ['SENT'],
    },
    {
      thread: 't-trip',
      from: noa,
      subject: 'Re: תכנון הטיול לצפון',
      ago: 420,
      html: reply(trip5, me, 'יום ה׳, 12 בנוב׳ 2026', reply(trip4, noa, 'יום ד׳, 11 בנוב׳ 2026', trip3)),
      labels: ['INBOX', PERSONAL],
    },
    {
      thread: 't-invite',
      from: roi,
      subject: `הזמנה: ישיבת צוות @ ${meeting.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} 10:00 - 11:00 (IST)`,
      ago: 600,
      html: rtl('שלום לכולם,', 'מזמין אתכם לישיבת הצוות השבועית.', `<b>מתי:</b> ${meeting.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}, 10:00 עד 11:00`, '<b>איפה:</b> חדר ישיבות 2', '', 'רועי'),
      labels: ['INBOX', 'UNREAD', PERSONAL, L_WORK],
      calendar: invitation(meeting),
    },
    {
      thread: 't-phish',
      from: fakeBank,
      subject: 'חשבונך הוגבל. נדרש אימות מיידי',
      ago: 700,
      html: rtl(
        'לקוח יקר,',
        'זיהינו פעילות חריגה בחשבונך, ולכן הגישה אליו הוגבלה.',
        'כדי להסיר את ההגבלה יש לאמת את פרטיך בתוך 24 שעות:',
        '<a href="https://bank-dugma-login.example/verify?id=7731">https://www.bank-dugma.example/login</a>',
        '',
        'בברכה, מחלקת האבטחה',
      ),
      labels: ['INBOX', 'UNREAD', PERSONAL],
      headers: { 'Reply-To': 'support@fast-verify.example' },
      auth: 'fail',
    },
    {
      thread: 't-friends',
      from: friends,
      subject: 'ל־3 חברים שלך יש יום הולדת השבוע',
      ago: 800,
      html: rtl('עומר, תמר ואבי חוגגים השבוע.', '<a href="https://reshet-haverim.example/birthdays">לברך אותם</a>'),
      labels: ['INBOX', SOCIAL],
      headers: { 'List-Unsubscribe': '<https://reshet-haverim.example/settings/mail>' },
    },
    {
      thread: 't-receipt',
      from: books,
      subject: 'קבלה על הזמנה 10482',
      ago: 900,
      html: rtl(
        'תודה שקנית בחנות הספרים.',
        '<b>הזמנה 10482</b>',
        'רומן בכריכה רכה: 89.00 ₪',
        'סימנייה: 12.00 ₪',
        'משלוח: 27.00 ₪',
        '<b>סה״כ לתשלום: 128.00 ₪</b>',
        'החיוב בוצע בכרטיס המסתיים ב־4417.',
      ),
      labels: ['INBOX', UPDATES],
    },
    {
      thread: 't-club',
      from: club,
      subject: 'הנקודות שלך מחכות',
      ago: 1300,
      html: promo('#24407a', 'צברת 1,240 נקודות', ['אפשר לממש אותן עד סוף החודש.', 'הטבה מיוחדת לחברי מועדון: קפה ומאפה ב־12 ₪.'], 'moadon.example'),
      labels: ['INBOX', PROMOTIONS],
      headers: { 'List-Unsubscribe': '<https://moadon.example/unsubscribe?u=911>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    },
    {
      thread: 't-cpa',
      from: shai,
      subject: 'מסמכים לדוח השנתי',
      ago: 1500,
      html: rtl('שלום,', 'כדי להגיש את הדוח השנתי אני צריך ממך עד סוף החודש:', '1. טופסי 106 מכל המעסיקים', '2. אישור שנתי מקרן הפנסיה', '3. קבלות על תרומות', '', 'תודה, שי'),
      labels: ['INBOX', 'STARRED', PERSONAL, L_BILLS],
    },
    {
      thread: 't-gan',
      from: gan,
      subject: 'סיכום שבועי: 6 הודעות חדשות בקבוצה',
      ago: 1700,
      html: rtl('<b>מסיבת חנוכה:</b> מי מביא סופגניות?', '<b>תזכורת:</b> ביום חמישי אין צהרון.', '<b>אבדה:</b> נמצא מעיל כחול, מידה 6.'),
      labels: ['INBOX', FORUMS],
      headers: { 'List-Unsubscribe': '<mailto:leave@groups.example>', 'List-Id': '<gan-shoshana.groups.example>' },
    },
    {
      thread: 't-flights',
      from: flights,
      subject: 'טיסות לאתונה מ־89 דולר',
      ago: 2000,
      html: promo('#0b6b61', 'אתונה מחכה לך', ['טיסות ישירות מ־89 דולר לכיוון.', 'ההצעה בתוקף ל־48 שעות.'], 'tisot.example'),
      labels: ['INBOX', 'UNREAD', PROMOTIONS],
      headers: { 'List-Unsubscribe': '<https://tisot.example/unsubscribe?u=58>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    },
    {
      thread: 't-spam',
      from: lottery,
      subject: 'זכית בפרס! לחץ כאן לקבלת הזכייה',
      ago: 2500,
      html: rtl('מזל טוב! נבחרת לזכות ב־50,000 ₪.', 'לקבלת הפרס יש למסור פרטי חשבון בנק.'),
      labels: ['SPAM', 'UNREAD'],
      auth: 'fail',
    },
    {
      thread: 't-weekly',
      from: weekly,
      subject: 'השבועון הטכנולוגי: גיליון 212',
      ago: 2600,
      html: rtl(
        '<h2>השבוע בטכנולוגיה</h2>',
        '<b>1. סוללות חדשות לרכב חשמלי.</b> חוקרים מדווחים על טעינה מלאה בתוך עשר דקות.',
        '<b>2. דפדפנים.</b> גרסה חדשה מביאה שיפור ניכר במהירות הטעינה של אתרים.',
        '<b>3. המלצת קריאה.</b> איך לכתוב קוד שקל לתחזק.',
        '',
        '<span style="color:#888;font-size:12px">להסרה מרשימת התפוצה השיבו למייל הזה עם המילה „הסרה”.</span>',
      ),
      labels: ['INBOX', PROMOTIONS],
      headers: { 'List-Unsubscribe': '<mailto:unsubscribe@shvuon-tech.example?subject=unsubscribe>' },
    },
    {
      thread: 't-cloud',
      from: cloud,
      subject: 'התחברות חדשה לחשבון שלך',
      ago: 3000,
      html: rtl('זיהינו התחברות לחשבון שלך ממכשיר חדש:', 'מחשב Windows, תל אביב.', 'אם זה היית אתה, אין צורך לעשות דבר.'),
      labels: ['INBOX', UPDATES],
    },
    {
      thread: 't-bill',
      from: electric,
      subject: 'חשבונית לחודש אוקטובר',
      ago: 4300,
      html: rtl('שלום,', 'מצורפת החשבונית לתקופה 1.10 עד 31.10.', '<b>סה״כ לתשלום: 342.50 ₪</b>', 'מועד אחרון לתשלום: 25.11.2026.'),
      labels: ['INBOX', UPDATES, L_BILLS],
      files: [{ filename: 'חשבונית-אוקטובר.pdf', mimeType: 'application/pdf', data: tinyPdf(['Electricity bill, October 2026', 'Total: 342.50 NIS', 'Pay by 25.11.2026']) }],
    },
    {
      // Already filed. It is here for its length: no form may grow wider than the screen because of it.
      thread: 't-receipt-long',
      from: park,
      subject: 'Receipt for your visit to the Northern Glacier National Park visitor centre and lagoon boat tour, booking 7H2K-99413-ZX',
      ago: 5200,
      html: ltr('Thank you for visiting.', 'Lagoon boat tour, 2 adults: $58.00', 'Parking: $6.00', '<b>Total: $64.00</b>'),
      labels: [UPDATES],
      files: [{ filename: 'Receipt-Northern-Glacier-National-Park-booking-7H2K-99413-ZX.pdf', mimeType: 'application/pdf', data: tinyPdf(['Receipt', 'Total: $64.00']) }],
    },
    {
      thread: 't-michal',
      from: me,
      to: [michal],
      subject: 'ברכות לרגל התפקיד החדש',
      ago: 4400,
      html: rtl('מיכל היקרה,', 'שמעתי על המינוי. מגיע לך! נקבע קפה כדי לחגוג?', '', 'בהצלחה רבה'),
      labels: ['SENT'],
    },
    {
      thread: 't-globalpost',
      from: globalPost,
      subject: 'Your package is on its way',
      ago: 5000,
      html: ltr('Hello,', 'Your order has shipped and is on its way to you.', 'Tracking number: <b>LP00123456789012</b>', 'Estimated delivery: November 24.', '<a href="https://globalpost.example/track?n=LP00123456789012">Track your package</a>'),
      labels: ['INBOX', UPDATES],
    },
    {
      thread: 't-sarah',
      from: me,
      to: [sarah],
      subject: 'Conference talk proposal',
      ago: 6000,
      html: ltr('Hi Sarah,', 'Attached is my proposal for a 30-minute talk on building offline-first web apps.', 'Happy to adjust the scope if needed.', '', 'Best regards'),
      labels: ['SENT'],
    },
    {
      thread: 't-sarah',
      from: sarah,
      subject: 'Re: Conference talk proposal',
      ago: 5600,
      html: reply(ltr('Thanks, this looks great. The committee meets on the 20th and I will get back to you right after.', '', 'Sarah'), me, 'Mon, Nov 9, 2026', ltr('Hi Sarah,', 'Attached is my proposal for a 30-minute talk on building offline-first web apps.')),
      labels: ['INBOX', PERSONAL, L_WORK],
    },
    {
      thread: 't-trash',
      from: club,
      subject: 'נשמח לשמוע את דעתך',
      ago: 7000,
      html: rtl('שתי דקות מזמנך: סקר שביעות רצון קצר.'),
      labels: ['TRASH', PROMOTIONS],
    },
    {
      thread: 't-vaad',
      from: vaad,
      subject: 'אסיפת דיירים ביום ראשון',
      ago: 9000,
      html: rtl('דיירים יקרים,', 'אסיפת הדיירים תתקיים ביום ראשון ב־20:00 בלובי.', 'על סדר היום: שיפוץ חדר המדרגות ותקציב 2027.'),
      labels: [PERSONAL, L_HOME],
    },
    {
      thread: 't-dana-old',
      from: dana,
      subject: 'סיכום הפגישה מהשבוע שעבר',
      ago: 11000,
      html: rtl('היי,', 'מצרפת את עיקרי הדברים: לוח הזמנים אושר, והתקציב יידון בפגישה הבאה.', '', 'דנה'),
      labels: [PERSONAL, L_WORK],
    },
    {
      thread: 't-draft',
      from: me,
      to: [yonatan],
      subject: 'שאלה לגבי לוח הזמנים',
      ago: 50,
      html: rtl('היי יונתן,', 'לפני שאני מאשר, רציתי לשאול מתי אפשר להתחיל בעבודות'),
      labels: ['DRAFT'],
    },
  ]

  // Older, ordinary letters, so the list is long enough to scroll and to fetch a second page.
  const older: [Person, string, string][] = [
    [omer, 'משחק כדורגל ביום חמישי?', 'חסר לנו שחקן אחד. בא לך להצטרף? מתחילים ב־20:30 במגרש ליד הפארק.'],
    [tamar, 'סקיצות ראשונות ללוגו', 'העליתי שלוש גרסאות לתיקייה המשותפת. אשמח להערות עד יום שני.'],
    [avi, 'עדכון סטטוס שבועי', 'סיימנו את שלב הבדיקות. נשארו שני באגים פתוחים, שניהם בעדיפות נמוכה.'],
    [liat, 'החוזה המתוקן', 'שילבתי את ההערות שלך בסעיפים 4 ו־7. בבקשה עבור עליהם ואשר.'],
    [teacher, 'טיול שנתי: אישור הורים', 'נא להחזיר את האישור החתום עד יום רביעי. הטיול ייצא ב־7:30 משער בית הספר.'],
    [omer, 'תודה על אתמול', 'היה ערב מצוין. בפעם הבאה אצלי.'],
    [avi, 'ימי חופשה בדצמבר', 'אני מתכנן לצאת לחופשה בין ה־20 ל־27. זה מסתדר עם לוח הזמנים?'],
    [tamar, 'חשבונית עבור חודש אוקטובר', 'מצרפת חשבונית על עבודת העיצוב. תנאי תשלום: שוטף פלוס 30.'],
    [dana, 'מסמכים לפגישה', 'שלחתי לך את המצגת. תגיד לי אם משהו חסר.'],
    [ima, 'ארוחת שישי', 'אתם באים בשישי? אני מכינה את המרק שאתה אוהב.'],
    [liat, 'תזכורת: חתימה אצל נוטריון', 'הפגישה נקבעה ליום שני ב־9:00. להביא תעודת זהות.'],
    [noa, 'ספר שכדאי לקרוא', 'סיימתי אתמול את הספר שדיברנו עליו. חייב לקרוא, אביא לך אותו.'],
    [teacher, 'אסיפת הורים', 'אסיפת ההורים תתקיים ביום שלישי הבא. שיבוץ לפי הטבלה המצורפת.'],
    [avi, 'סיכום ישיבת צוות', 'עיקרי ההחלטות: דוחים את ההשקה בשבוע, ומוסיפים סבב בדיקות.'],
  ]
  older.forEach(([person, subject, text], index) => {
    list.push({
      thread: `t-old-${index}`,
      from: person,
      subject,
      ago: 6500 + index * 1900,
      html: rtl('שלום,', text, '', person.name.split(',')[0]!.split(' ')[0]!),
      labels: ['INBOX', PERSONAL, ...(person === avi ? [L_WORK] : person === ima ? [L_FAMILY] : [])],
    })
  })
  return list
}

// ---------- Building messages ----------

let nextId = 1
let nextFile = 1

function verdict(from: Person, auth: Spec['auth']): string {
  const domain = from.email.split('@')[1] ?? ''
  if (auth === 'fail') return `mx.google.com; dkim=none; spf=softfail (google.com: domain of transitioning ${from.email} does not designate 203.0.113.9 as permitted sender) smtp.mailfrom=${from.email}; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=${domain}`
  if (auth === 'none') return `mx.google.com; spf=pass smtp.mailfrom=${from.email}`
  return `mx.google.com; dkim=pass header.i=@${domain} header.s=mail header.b=Zx81kq; spf=pass (google.com: domain of ${from.email} designates 198.51.100.7 as permitted sender) smtp.mailfrom=${from.email}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`
}

/** One message in Gmail's shape, from its parts. Used for the fixtures and for mail that "arrives" while the demo runs. */
export function makeMessage(
  spec: Omit<Spec, 'ago'> & { date: number; inReplyTo?: string; references?: string },
  files: Map<string, string>,
  historyId: number,
): DemoMessage {
  const id = `m${nextId++}`
  const text = plainText(spec.html)
  const to = spec.to ?? (spec.from === DEMO_ME ? [] : [DEMO_ME])
  const content = (type: string, data: string): Part => ({
    mimeType: type.split(';')[0]!,
    headers: [{ name: 'Content-Type', value: type }],
    body: { data, size: size64(data) },
  })
  const alternatives = [content('text/plain; charset="UTF-8"', text64(text)), content('text/html; charset="UTF-8"', text64(spec.html))]
  if (spec.calendar) alternatives.push(content('text/calendar; charset="UTF-8"; method=REQUEST', text64(spec.calendar)))

  let root: Part = { mimeType: 'multipart/alternative', headers: [], body: { size: 0 }, parts: alternatives }
  const attached = [...(spec.files ?? [])]
  if (spec.calendar) attached.push({ filename: 'invite.ics', mimeType: 'application/ics', data: text64(spec.calendar) })
  if (attached.length) {
    const parts = attached.map((file): Part => {
      const attachmentId = `att-${nextFile++}`
      files.set(attachmentId, file.data)
      return {
        mimeType: file.mimeType,
        filename: file.filename,
        headers: [
          { name: 'Content-Type', value: `${file.mimeType}; name="${file.filename}"` },
          { name: 'Content-Disposition', value: `attachment; filename="${file.filename}"` },
          ...(file.contentId ? [{ name: 'Content-ID', value: `<${file.contentId}>` }] : []),
        ],
        body: { attachmentId, size: size64(file.data) },
      }
    })
    root = { mimeType: 'multipart/mixed', headers: [], body: { size: 0 }, parts: [root, ...parts] }
  }

  const headers: Header[] = [
    { name: 'From', value: address(spec.from) },
    { name: 'To', value: to.map(address).join(', ') },
    ...(spec.cc?.length ? [{ name: 'Cc', value: spec.cc.map(address).join(', ') }] : []),
    { name: 'Subject', value: spec.subject },
    { name: 'Date', value: new Date(spec.date).toUTCString() },
    { name: 'Message-ID', value: `<${id}@${spec.from.email.split('@')[1]}>` },
    ...(spec.inReplyTo ? [{ name: 'In-Reply-To', value: spec.inReplyTo }] : []),
    ...(spec.references ? [{ name: 'References', value: spec.references }] : []),
    { name: 'Content-Type', value: root.mimeType === 'multipart/mixed' ? 'multipart/mixed; boundary="demo"' : 'multipart/alternative; boundary="demo"' },
    ...(spec.from === DEMO_ME ? [] : [{ name: 'Authentication-Results', value: verdict(spec.from, spec.auth) }]),
    ...Object.entries(spec.headers ?? {}).map(([name, value]) => ({ name, value })),
  ]
  root.headers = headers

  return {
    id,
    threadId: spec.thread,
    labelIds: [...spec.labels],
    snippet: text.replace(/\s+/g, ' ').slice(0, 170),
    internalDate: spec.date,
    historyId,
    payload: root,
    search: [spec.subject, address(spec.from), to.map(address).join(' '), text].join(' ').toLowerCase(),
  }
}

export function buildMailbox(): DemoMailbox {
  const files = new Map<string, string>()
  const now = Date.now()
  const lastInThread = new Map<string, DemoMessage>()
  let history = 1000
  const messages = specs()
    .sort((a, b) => b.ago - a.ago)
    .map((spec) => {
      const previous = lastInThread.get(spec.thread)
      const previousId = previous?.payload.headers.find((header) => header.name === 'Message-ID')?.value
      const previousRefs = previous?.payload.headers.find((header) => header.name === 'References')?.value
      const message = makeMessage(
        {
          ...spec,
          date: now - spec.ago * 60_000,
          inReplyTo: previousId,
          references: previousId ? [previousRefs, previousId].filter(Boolean).join(' ') : undefined,
        },
        files,
        ++history,
      )
      lastInThread.set(spec.thread, message)
      return message
    })

  const system = ['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'STARRED', 'UNREAD', 'IMPORTANT', PERSONAL, UPDATES, PROMOTIONS, SOCIAL, FORUMS]
  const labels: DemoLabel[] = [
    ...system.map((id): DemoLabel => ({ id, name: id, type: 'system' })),
    { id: L_BILLS, name: 'חשבונות', type: 'user', color: { backgroundColor: '#16a766', textColor: '#ffffff' } },
    { id: L_WORK, name: 'עבודה', type: 'user', color: { backgroundColor: '#4a86e8', textColor: '#ffffff' } },
    { id: L_FAMILY, name: 'משפחה', type: 'user', color: { backgroundColor: '#f691b3', textColor: '#ffffff' } },
    { id: L_HOME, name: 'בית', type: 'user' },
  ]
  return { messages, labels, files }
}
