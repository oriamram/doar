// Checks the pure parts of Doar's server: one-time codes, opening hours, reminders,
// notification tickets and the home-screen widget (supabase/functions/postman/*.ts).
//
//   node --experimental-strip-types scripts/check-postman.ts

import { findCode, formatCode } from '../supabase/functions/postman/codes.ts'
import { isOpen, localTime, sunsetMinutes, validHours, type Hours } from '../supabase/functions/postman/hours.ts'
import { replyState, validDays, validDue } from '../supabase/functions/postman/reminders.ts'
import { readTicket, signTicket } from '../supabase/functions/postman/tickets.ts'
import { newWidgetKey, validWidgetKey, widgetKeyHash, widgetLetter, widgetQuery } from '../supabase/functions/postman/widget.ts'

let failed = false
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`)
  if (!ok) failed = true
}

// ---------- One-time codes ----------

check('a Hebrew code in the subject', findCode('קוד האימות שלך: 482913', ''), '482913')
check('an English code in the text', findCode('Your verification code', 'Your verification code is 482 913. It expires in 10 minutes.'), '482913')
check('a code that leads the sentence', findCode('482913 is your Doar verification code', ''), '482913')
check('a code with a letter prefix', findCode('G-482913 is your verification code', ''), '482913')
check('a four-digit code', findCode('קוד חד-פעמי לכניסה: 7731', ''), '7731')
check('an eight-digit code in two halves', findCode('Sign in', 'Use code 4829-1345 to sign in to your account.'), '48291345')
check('a one-time password in the text', findCode('סיסמה חד פעמית', 'הסיסמה החד פעמית שלך היא 904415 והיא בתוקף לחמש דקות'), '904415')
check('a one-time password, worded plainly', findCode('סיסמה חד פעמית לכניסה לאתר', 'סיסמה חד פעמית: 904415. בתוקף לחמש דקות.'), '904415')
check('the code nearest its words wins', findCode('Login code', 'Order 55123 was placed. Your login code is 771204.'), '771204')
check('"OTP" counts', findCode('OTP for your transaction', 'Your OTP is 338291. Do not share it.'), '338291')
check('a receipt is not a code', findCode('קבלה על הזמנה 10482', 'תודה שקנית. סה״כ לתשלום: 128.00 ₪'), null)
check('a coupon is not a code', findCode('קוד קופון: SAVE20', 'עד 50% הנחה, בתוקף עד 30.11.2026'), null)
check('an order number is not a code', findCode('Your order #482913 has shipped', 'Track it online.'), null)
check('a year is not a code', findCode('Verification code policy update 2026', ''), null)
check('an amount is not a code', findCode('קוד האימות', 'חיוב על סך 4829 ₪ בוצע בכרטיסך.'), null)
check('a card ending is not a code', findCode('Security code reminder', 'For your card ending in 4417, never share your security code.'), null)
check('a phone number is not a code', findCode('קוד האימות לא התקבל?', 'התקשרו אלינו: 03-1234567'), null)
check('ordinary mail has no code', findCode('אישור פגישה ביום שלישי', 'רציתי לוודא שיום שלישי ב־10:00 עדיין מתאים לך.'), null)
check('six digits are read in threes', formatCode('482913'), '482 913')
check('eight digits are read in fours', formatCode('48291345'), '4829 1345')
check('other lengths stay whole', formatCode('7731'), '7731')

// ---------- Opening hours ----------

const at = (iso: string) => new Date(iso)
const always: Hours = { from: '00:00', to: '00:00', days: [0, 1, 2, 3, 4, 5, 6], shabbat: true, tz: 'Asia/Jerusalem' }
const office: Hours = { from: '07:00', to: '22:00', days: [0, 1, 2, 3, 4], shabbat: false, tz: 'Asia/Jerusalem' }
const night: Hours = { from: '22:00', to: '06:00', days: [0, 1, 2, 3, 4, 5, 6], shabbat: false, tz: 'Asia/Jerusalem' }

const close = (name: string, got: number, want: number, slack: number) => check(`${name} (${Math.floor(got / 60)}:${String(got % 60).padStart(2, '0')})`, Math.abs(got - want) <= slack, true)
close('sunset in Tel Aviv in November', sunsetMinutes(2026, 11, 13, 32.07, 34.78, 120), 16 * 60 + 42, 5)
close('sunset in Tel Aviv in June', sunsetMinutes(2026, 6, 19, 32.07, 34.78, 180), 19 * 60 + 49, 5)
close('sunset in Tel Aviv in March', sunsetMinutes(2026, 3, 20, 32.07, 34.78, 120), 17 * 60 + 52, 5)

const friday = localTime(at('2026-11-13T13:00:00Z'), 'Asia/Jerusalem')
check('the wall clock in Israel in winter', [friday.weekday, friday.minutes, friday.offset], [5, 15 * 60, 120])
check('the wall clock in Israel in summer', localTime(at('2026-06-19T13:00:00Z'), 'Asia/Jerusalem').offset, 180)

check('Friday afternoon is open', isOpen(always, at('2026-11-13T13:00:00Z')), true)
check('Friday near sunset is closed', isOpen(always, at('2026-11-13T14:30:00Z')), false)
check('Saturday noon is closed', isOpen(always, at('2026-11-14T10:00:00Z')), false)
check('Saturday just after sunset is still closed', isOpen(always, at('2026-11-14T15:10:00Z')), false)
check('Saturday night is open again', isOpen(always, at('2026-11-14T15:40:00Z')), true)
check('a summer Friday at six is still open', isOpen(always, at('2026-06-19T15:00:00Z')), true)
check('a summer Friday at eight is closed', isOpen(always, at('2026-06-19T17:00:00Z')), false)

check('before opening time is closed', isOpen(office, at('2026-11-15T04:30:00Z')), false)
check('opening time is open', isOpen(office, at('2026-11-15T05:00:00Z')), true)
check('a minute before closing is open', isOpen(office, at('2026-11-15T19:59:00Z')), true)
check('closing time is closed', isOpen(office, at('2026-11-15T20:00:00Z')), false)
check('a day that is not listed is closed', isOpen(office, at('2026-11-13T08:00:00Z')), false)
check('hours past midnight: late evening', isOpen(night, at('2026-11-15T21:00:00Z')), true)
check('hours past midnight: early morning', isOpen(night, at('2026-11-15T03:00:00Z')), true)
check('hours past midnight: noon', isOpen(night, at('2026-11-15T10:00:00Z')), false)

check('good hours are accepted', validHours({ from: '07:00', to: '22:00', days: [0, 1, 1, 4], shabbat: true, tz: 'Asia/Jerusalem' }), {
  from: '07:00',
  to: '22:00',
  days: [0, 1, 4],
  shabbat: true,
  tz: 'Asia/Jerusalem',
})
check('a bad clock is refused', validHours({ from: '7:00', to: '22:00', days: [0], shabbat: false, tz: 'Asia/Jerusalem' }), null)
check('a bad day is refused', validHours({ from: '07:00', to: '22:00', days: [7], shabbat: false, tz: 'Asia/Jerusalem' }), null)
check('a made-up time zone is refused', validHours({ from: '07:00', to: '22:00', days: [0], shabbat: false, tz: 'Mars/Olympus' }), null)
check('nothing is refused', validHours(null), null)

// ---------- Registered mail and held mail ----------

const sent = { id: 'a', labelIds: ['SENT'], internalDate: '1000' }
check('no answer yet', replyState({ messages: [sent] }, 'a'), 'waiting')
check('an answer arrived', replyState({ messages: [sent, { id: 'b', labelIds: ['INBOX', 'UNREAD'], internalDate: '2000' }] }, 'a'), 'answered')
check('my own follow-up is not an answer', replyState({ messages: [sent, { id: 'b', labelIds: ['SENT'], internalDate: '2000' }] }, 'a'), 'waiting')
check('a letter to myself is not an answer', replyState({ messages: [{ id: 'a', labelIds: ['SENT', 'INBOX'], internalDate: '1000' }] }, 'a'), 'waiting')
check('a draft is not an answer', replyState({ messages: [sent, { id: 'b', labelIds: ['DRAFT'], internalDate: '2000' }] }, 'a'), 'waiting')
check('an earlier letter is not an answer', replyState({ messages: [{ id: 'z', labelIds: ['INBOX'], internalDate: '500' }, sent] }, 'a'), 'waiting')
check('an answered letter stays answered when filed', replyState({ messages: [sent, { id: 'b', labelIds: [], internalDate: '2000' }] }, 'a'), 'answered')
check('the sent letter was deleted', replyState({ messages: [{ id: 'b', labelIds: ['INBOX'], internalDate: '2000' }] }, 'a'), 'gone')
check('an empty conversation', replyState({}, 'a'), 'gone')

const now = Date.parse('2026-11-13T12:00:00Z')
check('a time in an hour is fine', validDue('2026-11-13T13:00:00Z', now), '2026-11-13T13:00:00.000Z')
check('a time that passed is refused', validDue('2026-11-13T11:00:00Z', now), null)
check('a time two years away is refused', validDue('2028-11-13T11:00:00Z', now), null)
check('nonsense is refused', validDue('tomorrow', now), null)
check('three days is fine', validDays(3), 3)
check('zero days is refused', validDays(0), null)
check('half a day is refused', validDays(1.5), null)

// ---------- Notification tickets ----------

const secret = 'a-secret-for-the-check'
const good = await signTicket({ u: 'user-1', t: 'thread-1', e: now + 60_000, k: 'reply', d: 3, m: 'msg-1' }, secret)
check('a fresh ticket reads back', await readTicket(good, secret, now), { u: 'user-1', t: 'thread-1', e: now + 60_000, k: 'reply', d: 3, m: 'msg-1' })
check('a ticket past its time is refused', await readTicket(good, secret, now + 120_000), null)
check('a ticket signed with another secret is refused', await readTicket(good, 'another-secret', now), null)
const [body, signature] = good.split('.')
const forged = `${Buffer.from(JSON.stringify({ u: 'someone-else', t: 'thread-1', e: now + 60_000 })).toString('base64url')}.${signature}`
check('a ticket whose contents were changed is refused', await readTicket(forged, secret, now), null)
check('a ticket with a cut signature is refused', await readTicket(`${body}.${signature!.slice(0, 10)}`, secret, now), null)
check('nonsense is refused as a ticket', await readTicket('hello', secret, now), null)

// ---------- The home-screen widget ----------

const head = (from: string, subject?: string) => ({ headers: [{ name: 'From', value: from }, ...(subject === undefined ? [] : [{ name: 'Subject', value: subject }])] })
check(
  'a conversation as the widget shows it',
  widgetLetter({
    id: 't1',
    messages: [
      { labelIds: ['INBOX'], internalDate: '1000', snippet: 'שלום', payload: head('"Dana Levi" <dana@example.com>', 'פגישה ביום שלישי') },
      { labelIds: ['SENT'], internalDate: '2000', snippet: 'מתאים לי', payload: head('Me <me@example.com>', 'Re: פגישה ביום שלישי') },
      { labelIds: ['INBOX', 'UNREAD', 'STARRED'], internalDate: '3000', snippet: 'אז ב&quot;10&quot;?', payload: head('Dana Levi <dana@example.com>') },
    ],
  }),
  { thread: 't1', from: 'Dana Levi', subject: 'פגישה ביום שלישי', preview: 'אז ב"10"?', at: 3000, unread: true, starred: true, count: 3, code: null },
)
check(
  'my own last answer: the time is of the letter I got, the name is theirs',
  widgetLetter({
    id: 't2',
    messages: [
      { labelIds: ['INBOX'], internalDate: '1000', snippet: 'a', payload: head('=?UTF-8?B?16nXmdeo?= <shir@example.com>', 'שאלה') },
      { labelIds: ['SENT'], internalDate: '2000', snippet: 'b', payload: head('me@example.com') },
    ],
  })?.from,
  'שיר',
)
check(
  'an unread code is written out',
  widgetLetter({ id: 't3', messages: [{ labelIds: ['INBOX', 'UNREAD'], internalDate: '1', snippet: 'Your code is 482913', payload: head('Bank <no-reply@bank.example>', 'Your verification code') }] })?.code,
  '482 913',
)
check(
  'a code already read is not',
  widgetLetter({ id: 't4', messages: [{ labelIds: ['INBOX'], internalDate: '1', snippet: 'Your code is 482913', payload: head('Bank <no-reply@bank.example>', 'Your verification code') }] })?.code,
  null,
)
check('a letter with no subject', widgetLetter({ id: 't5', messages: [{ labelIds: ['INBOX'], payload: head('a@b.example') }] })?.subject, '(בלי נושא)')
check('an empty conversation has no row', widgetLetter({ id: 't6', messages: [] }), null)
check('with bundles, the widget shows the desk', widgetQuery(true), 'in:inbox -category:updates -category:promotions -category:social -category:forums')
check('without bundles, the whole inbox', widgetQuery(false), 'in:inbox')
check('the unread count asks for unread', widgetQuery(false, true), 'in:inbox is:unread')
const widgetKey = newWidgetKey()
check('a widget key is 43 link-safe characters', validWidgetKey(widgetKey), true)
check('two widget keys differ', widgetKey === newWidgetKey(), false)
check('a short key is refused', validWidgetKey('abc'), false)
check('a key is kept as its SHA-256', await widgetKeyHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

if (failed) process.exit(1)
