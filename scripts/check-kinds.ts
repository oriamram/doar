// Checks how Doar tells kinds of mail apart (src/lib/kinds.ts): codes, parcels, receipts,
// invitations and leaflets, and the look-alikes that must stay plain letters.
//
//   node --experimental-strip-types scripts/check-kinds.ts

import { calendarLink, findAmount, formatAmount, isFresh, parseInvite, shapeOf, type Facts } from '../src/lib/kinds.ts'

let failed = false
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`)
  if (!ok) failed = true
}

const kind = (subject: string, text = '', more: Partial<Facts> = {}) => shapeOf({ subject, text, ...more }).kind
const shape = (subject: string, text = '', more: Partial<Facts> = {}) => shapeOf({ subject, text, ...more })

// ---------- Codes ----------

check('a code is a code', shape('קוד האימות שלך: 482913', 'שלום, קוד האימות שלך לכניסה לחשבון הוא 482913.'), { kind: 'code', code: '482913' })
check('an English code', shape('Your verification code', 'Your verification code is 482 913. It expires in 10 minutes.'), { kind: 'code', code: '482913' })
check("a shop's coupon code is a leaflet", kind('Use code 482913 for 20% off', 'Only this week.', { promotion: true, bulk: true }), 'leaflet')
check('a code from a mailing list is still a code', kind('קוד האימות שלך: 482913', '', { bulk: true }), 'code')

// ---------- Parcels ----------

check(
  'a parcel waiting for pick-up',
  shape('החבילה שלך ממתינה לאיסוף', 'שלום, חבילה מספר RR123456789IL הגיעה לנקודת האיסוף: דואר שכונתי, רחוב הגפן 12.'),
  { kind: 'parcel', number: 'RR123456789IL', status: 'ready' },
)
check('a parcel on its way, in English', shape('Your package is on its way', 'Tracking number: 7712345678. Expected on Monday.'), { kind: 'parcel', number: '7712345678', status: 'way' })
check('an order that shipped', shape('Your order has shipped', 'It left our warehouse today.'), { kind: 'parcel', number: null, status: 'way' })
check('a delivered parcel', shape('המשלוח שלך נמסר', 'המשלוח נמסר היום בשעה 14:20.').kind === 'parcel' && shape('המשלוח שלך נמסר', '').kind, 'parcel')
check('its status is "delivered"', shape('המשלוח שלך נמסר', ''), { kind: 'parcel', number: null, status: 'delivered' })
check('a delayed parcel', shape('עדכון משלוח: עיכוב במסירה', 'מספר מעקב: LP00412345678901'), { kind: 'parcel', number: 'LP00412345678901', status: 'problem' })
check('a UPS number by its form', shape('Delivery update', 'Your parcel 1Z999AA10123456784 is out for delivery.'), { kind: 'parcel', number: '1Z999AA10123456784', status: 'way' })
check('a tracking number alone, with words about a delivery', kind('עדכון מהחנות', 'החבילה RR123456789IL יצאה מהמחסן.'), 'parcel')
check('"free shipping" in a promotion is a leaflet', kind('משלוח חינם על כל האתר', 'המשלוח שלך עלינו עד יום שישי.', { promotion: true }), 'leaflet')
check('an order that was received is not a parcel', kind('ההזמנה שלך התקבלה', 'נעדכן אותך כשהיא תישלח.'), 'letter')
check('a friend writing about a parcel is a letter', kind('שכחתי אצלך משהו', 'אפשר לשלוח לי את זה בחבילה? תודה!'), 'letter')
check('a letter that mentions a flight number is a letter', kind('פרטי הטיסה', 'טיסה LY315 ממריאה ב־10:40, שער B4.'), 'letter')

// ---------- Receipts ----------

const bookshop = 'תודה שקנית בחנות הספרים. הזמנה 10482 רומן בכריכה רכה: 89.00 ₪ סימנייה: 12.00 ₪ משלוח: 27.00 ₪ סה״כ לתשלום: 128.00 ₪ החיוב בוצע בכרטיס המסתיים ב־4417.'
check('a receipt, with its total', shape('קבלה על הזמנה 10482', bookshop), { kind: 'receipt', amount: { value: 128, currency: '₪' } })
check('a monthly invoice', shape('חשבונית לחודש אוקטובר', 'סכום לתשלום: 342.50 ₪ עד 25.11.2026'), { kind: 'receipt', amount: { value: 342.5, currency: '₪' } })
check('a receipt in English', shape('Your receipt from Example Store', 'Subtotal: $40.00 Shipping: $5.00 Total: $45.00'), { kind: 'receipt', amount: { value: 45, currency: '$' } })
check('a receipt with no sum in its first words', shape('קבלה מספר 5521', 'מצורפת הקבלה עבור התשלום.'), { kind: 'receipt', amount: null })
check('an order confirmation with a sum', shape('אישור הזמנה 7781', 'תודה. סה"כ: 1,249.90 ש"ח'), { kind: 'receipt', amount: { value: 1249.9, currency: '₪' } })
check('an order confirmation with no sum is a letter', kind('אישור הזמנה', 'נשמח לראותך ביום חמישי בשעה 20:00.'), 'letter')
check('"the order was received" is not a receipt', kind('ההזמנה התקבלה במערכת', 'נחזור אליך בהקדם.'), 'letter')
check('a sale that names a price is a leaflet', kind('קבלו 50 ₪ מתנה', 'רק היום.', { promotion: true }), 'leaflet')
check('a friend asking about a receipt… is still a receipt by its subject', kind('הקבלה מהמסעדה', 'שילמנו 420 ₪, נתחלק?'), 'receipt')
check('"reception" is not a receipt', kind('Reception at the embassy', 'You are invited.'), 'letter')

check('the total wins over the largest line', findAmount('Item A: $300.00 Discount: -$280.00 Total: $20.00'), { value: 20, currency: '$' })
check('with no "total", the largest sum', findAmount('קפה 12 ₪, מאפה 18 ₪, ארוחה 64 ₪'), { value: 64, currency: '₪' })
check('thousands with commas', findAmount('סך הכל 48,500 ש״ח'), { value: 48500, currency: '₪' })
check('a percentage is not money', findAmount('50% הנחה על הכל'), null)
check('"tennis 50" is not fifty shekels', findAmount('tennis 50 at the club'), null)
check('a year is not money', findAmount('בתוקף עד 30.11.2026'), null)
check('shekels are written after the number', formatAmount({ value: 128, currency: '₪' }), '128.00 ₪')
check('dollars before it', formatAmount({ value: 1249.9, currency: '$' }), '$1,249.90')

// ---------- Invitations ----------

check('a calendar invitation by its part', kind('ישיבת צוות', 'מזמין אתכם לישיבה.', { calendar: true }), 'invitation')
check('a calendar invitation by its subject', kind('הזמנה: ישיבת צוות @ יום ג׳ 17 בנוב׳ 2026 10:00', ''), 'invitation')
check('an English invitation', kind('Invitation: Weekly sync @ Tue Nov 17, 2026 10am - 11am (IST)', ''), 'invitation')
check('"an invitation to a sale" in a promotion is a leaflet', kind('הזמנה: אירוע מכירות @ הקניון', '', { promotion: true }), 'leaflet')
check('"הזמנה:" with no time after it is a letter', kind('הזמנה: אירוע מכירות מיוחד', ''), 'letter')
check('a letter that says "invitation" inside is a letter', kind('לגבי ההזמנה לחתונה', 'קיבלתם את ההזמנה?'), 'letter')

// ---------- Leaflets, letters, and corrections ----------

check('mail from a list is a leaflet', kind('השבועון הטכנולוגי: גיליון 212', 'השבוע: שבבים חדשים.', { bulk: true }), 'leaflet')
check('a promotion is a leaflet', kind('מבצעי סוף העונה', 'עד 50% על הכל', { promotion: true }), 'leaflet')
check('a plain letter is a letter', kind('אישור פגישה ביום שלישי', 'רציתי לוודא שיום שלישי ב־10:00 עדיין מתאים לך.'), 'letter')
check('what I wrote myself is a letter', kind('קבלה על התשלום', 'מצרף קבלה. סה״כ 300 ₪', { outgoing: true }), 'letter')
check('"not a code" is remembered', kind('קוד האימות שלך: 482913', '', { not: ['code'] }), 'letter')
check('"not a parcel" falls through to the next kind', kind('החבילה שלך ממתינה לאיסוף', '', { not: ['parcel'], bulk: true }), 'leaflet')
check('"not a leaflet" makes it a letter', kind('סיכום שבועי', '', { bulk: true, not: ['leaflet'] }), 'letter')

const now = Date.parse('2026-11-13T12:00:00Z')
check('a code three minutes old is fresh', isFresh('2026-11-13T11:57:00Z', now), true)
check('a code twenty minutes old is not', isFresh('2026-11-13T11:40:00Z', now), false)

// ---------- Reading a calendar file ----------

const ics = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20261117T080000Z',
  'DTEND:20261117T090000Z',
  'SUMMARY:ישיבת צוות\\, שבועית',
  'LOCATION:חדר ישיבות 2',
  'ORGANIZER;CN=רועי שגב:mailto:roi@segev-team.example',
  'DESCRIPTION:שורה ארוכה שנשברת',
  ' באמצע',
  'BEGIN:VALARM',
  'TRIGGER:-PT10M',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')
const invite = parseInvite(ics)
check('an event is read', invite && [invite.title, invite.location, invite.organizer, invite.allDay, invite.cancelled], ['ישיבת צוות, שבועית', 'חדר ישיבות 2', 'רועי שגב', false, false])
check('its start is the right instant', invite?.start.toISOString(), '2026-11-17T08:00:00.000Z')
check('its end too', invite?.end?.toISOString(), '2026-11-17T09:00:00.000Z')

const zonedIcs = 'BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Jerusalem:20261117T100000\r\nDTEND;TZID=Asia/Jerusalem:20261117T110000\r\nSUMMARY:Sync\r\nEND:VEVENT'
check('a time in a named zone (winter, UTC+2)', parseInvite(zonedIcs)?.start.toISOString(), '2026-11-17T08:00:00.000Z')
const summerIcs = 'BEGIN:VEVENT\r\nDTSTART;TZID=Asia/Jerusalem:20260714T100000\r\nSUMMARY:Sync\r\nEND:VEVENT'
check('the same zone in summer (UTC+3)', parseInvite(summerIcs)?.start.toISOString(), '2026-07-14T07:00:00.000Z')
const dayIcs = 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nSUMMARY:יום הולדת\r\nEND:VEVENT'
const wholeDay = parseInvite(dayIcs)
check('a whole-day event', wholeDay && [wholeDay.allDay, wholeDay.start.getFullYear(), wholeDay.start.getMonth(), wholeDay.start.getDate()], [true, 2026, 10, 20])
check('a cancelled event', parseInvite('METHOD:CANCEL\r\nBEGIN:VEVENT\r\nDTSTART:20261117T080000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT')?.cancelled, true)
check('a file with no event', parseInvite('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), null)
check('an event with no start', parseInvite('BEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT'), null)

const link = invite ? new URL(calendarLink(invite)) : null
check('the calendar link carries the event', link && [link.host, link.searchParams.get('action'), link.searchParams.get('text'), link.searchParams.get('dates'), link.searchParams.get('location')], [
  'calendar.google.com',
  'TEMPLATE',
  'ישיבת צוות, שבועית',
  '20261117T080000Z/20261117T090000Z',
  'חדר ישיבות 2',
])
check('a whole day is written as dates', wholeDay && new URL(calendarLink(wholeDay)).searchParams.get('dates'), '20261120/20261121')

if (failed) {
  console.error('\nsome kinds were told apart wrongly')
  process.exit(1)
}
console.log('\nall kinds are told apart')
