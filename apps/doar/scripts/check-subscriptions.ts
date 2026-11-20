// Checks how subscriptions are found in receipts (src/lib/subscriptions.ts). The letters are
// made up, built the way real ones are: a Stripe receipt with a billing period and a plan
// line, an app store's renewal, a parking receipt that is not a subscription, an invoice sent twice.
//
//   node --experimental-strip-types scripts/check-subscriptions.ts

import { gather, inShekels, periodOfDays, plainName, readCharge, siteOf, type Charge, type Letter } from '../src/lib/subscriptions.ts'

let failed = false
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`)
  if (!ok) failed = true
}

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 19)
const ago = (days: number) => NOW - days * DAY
const letter = (from: string, email: string, subject: string, text: string, days: number, receipt = true): Letter => ({
  thread: `t-${email}-${days}`,
  at: ago(days),
  from: { name: from, email },
  subject,
  text,
  receipt,
})

// ---------- One letter ----------

const stripe = (amount: string, period: string, line: string) =>
  `Notely, Inc. Receipt from Notely, Inc. ${amount} Paid on November 12, 2026 Receipt #1111-2222 ${period} ${line} Total ${amount} Amount paid ${amount} Questions? Powered by stripe`
const upgrade = readCharge(
  letter('Notely, Inc.', 'invoice+statements@mail.notely.example', 'Your receipt from Notely, Inc. #1111-2222', stripe('$42.50', 'Nov 12–Dec 12, 2026', 'Notely Team Qty 1 $50.00 Unused time on Notely Solo after 12 Nov 2026 Qty 1 -$7.50'), 7),
)!
check('a Stripe receipt: what was paid', upgrade.amount, { value: 42.5, currency: '$' })
check('a Stripe receipt: the plan and its own price, before the credit', [upgrade.plan, upgrade.price], ['Notely Team', { value: 50, currency: '$' }])
check('a Stripe receipt: the billing period makes it monthly', [upgrade.period, upgrade.recurring], ['month', true])
check('a Stripe receipt: the sender is its site, without "Inc."', [upgrade.key, upgrade.name], ['notely.example', 'Notely'])

const yearly = readCharge(letter('Maps Co', 'billing@maps.example', 'Receipt', stripe('€48.00', 'Dec 28, 2025 – Dec 28, 2026', 'Maps Explorer Qty 1 €48.00'), 330))!
check('a period across a new year is a year', yearly.period, 'year')

const brand = readCharge(
  letter('Flowworks Inc.', 'invoice+statements@automate.example', 'Your receipt from Flowworks Inc.', stripe('$10.59', 'May 16–Jun 16, 2026', 'Automate Core plan (10000 credits / month) - monthly subscription Qty 1 $10.59'), 180),
)!
check('a brand billed by the company behind it is called by the brand', brand.name, 'Automate')
check('a plan without its notes in brackets and after a dash', brand.plan, 'Automate Core plan')
const longLine = readCharge(
  letter('Flowworks Inc.', 'invoice+statements@automate.example', 'Your receipt from Flowworks Inc.', stripe('$10.59', 'May 16–Jun 16, 2026', 'Automate Core plan (10000 credits / month) - monthly subscription (organization ID: 1234567) Qty 1 $10.59'), 180),
)!
check('a plan line with long notes is still read, and names the brand', [longLine.plan, longLine.name], ['Automate Core plan', 'Automate'])

const store = readCharge(
  letter(
    'Apple',
    'no_reply@email.apple.example',
    'Your receipt from Apple.',
    'Receipt 8 October 2026 Order ID: AB12 Apple Account: someone@example.com iCloud iCloud+ with 200 GB of storage (Monthly) Renews 9 November 2026 ₪11.90 Billing and Payment Mastercard ₪11.90',
    42,
  ),
)!
check('an app store renewal: the plan, monthly, in shekels', [store.plan, store.period, store.amount], ['iCloud+ with 200 GB of storage', 'month', { value: 11.9, currency: '₪' }])
check('an app store: called by its name, the plan apart', store.name, 'Apple')

const hebrew = readCharge(letter('סטרים פלוס בע"מ', 'billing@stream-plus.co.il', 'חשבונית מס קבלה - מנוי חודשי', 'תודה! חויב מנוי פרימיום חודשי. סה"כ לתשלום: 39.90 ש"ח', 20))!
check('a Hebrew monthly subscription', [hebrew.period, hebrew.recurring, hebrew.amount, hebrew.name, hebrew.key], ['month', true, { value: 39.9, currency: '₪' }, 'סטרים פלוס', 'stream-plus.co.il'])

const parking = readCharge(
  letter('Parkpay', 'no-reply@parkpay.example', 'P1 - Receipt', 'Zone 1000 Parking lot P1 Receipt for payment Paid at 06-09-2026 kl 17:00 License plate XX000 Total 750 kr', 70),
)!
check('a parking receipt is a charge, not said to be a subscription', [parking.recurring, parking.period], [false, null])

check('a reminder of a charge to come is not a charge', readCharge(letter('Notely', 'news@notely.example', 'Your plan renews soon', 'Your Notely Team plan will renew on Dec 12 for $50.00.', 3, false)), null)
check('a receipt with no sum in it is not a charge', readCharge(letter('אוניברסיטה', 'do-not-reply@uni.ac.il', 'קבלה על תנאי', 'הודעה על אי עמידה בדרישות', 300)), null)

check('sites: a sub-domain is its site', siteOf('invoice+statements@mail.notely.example'), 'notely.example')
check('sites: an Israeli company keeps three parts', siteOf('billing@service.bezeq.co.il'), 'bezeq.co.il')
check('names: Hebrew company ending', plainName('נייטס אנטרטיינמנט בע״מ'), 'נייטס אנטרטיינמנט')
check('periods from days', [periodOfDays(30), periodOfDays(31), periodOfDays(7), periodOfDays(365), periodOfDays(60)], ['month', 'month', 'week', 'year', null])

// ---------- Many letters ----------

const charges: Charge[] = []
const add = (charge: Charge | null) => charge && charges.push(charge)
// Notely: plain monthly receipts, then an upgrade.
for (const days of [97, 67, 37]) add(readCharge(letter('Notely, Inc.', 'invoice+statements@mail.notely.example', 'Your receipt from Notely', stripe('$20.00', 'Aug 14–Sep 14, 2026', 'Notely Solo Qty 1 $20.00'), days)))
charges.push(upgrade)
add(store)
add(hebrew)
add(brand)
// A gym that never says "subscription", but charges the same every month.
for (const days of [95, 64, 34, 4]) add(readCharge(letter('Gym Ltd', 'pay@gym.example', 'Receipt', 'Thank you. Total ₪180.00', days)))
// Parking: many receipts in a week, different sums.
for (const [days, sum] of [[70, 750], [69, 1000], [69, 450], [68, 900]] as const)
  add(readCharge(letter('Parkpay', 'no-reply@parkpay.example', 'Receipt', `Receipt for payment Paid at Total ${sum} kr`, days)))
// An airline that sent the same invoice twice, two days apart.
add(readCharge(letter('Fly', 'dontreply@fly.example', 'חשבונית 133', 'סה"כ 1,240.00 ₪', 160)))
add(readCharge(letter('Fly', 'dontreply@fly.example', 'חשבונית 133', 'סה"כ 1,240.00 ₪', 158)))

const { subscriptions, others } = gather(charges, NOW)
const by = (key: string) => subscriptions.find((item) => item.key === key)
check('found: Notely, the store plan, the Hebrew one, the brand and the gym', subscriptions.map((item) => item.key).sort(), [
  'apple.example',
  'automate.example',
  'gym.example',
  'notely.example',
  'stream-plus.co.il',
])
check('Notely: four receipts, the newest plan and price, its year in dollars', [by('notely.example')!.charges.length, by('notely.example')!.plan, by('notely.example')!.price, by('notely.example')!.year], [
  4,
  'Notely Team',
  { value: 50, currency: '$' },
  [{ value: 102.5, currency: '$' }],
])
check('Notely: the next charge a month after the last', Math.round((by('notely.example')!.nextAt! - ago(7)) / DAY), 30)
check('the gym counts by its steady pace', [by('gym.example')!.because, by('gym.example')!.period, by('gym.example')!.monthly], ['pace', 'month', { value: 180, currency: '₪' }])
check('the brand has not charged since May: it ended', by('automate.example')!.active, false)
check('active ones come first', subscriptions.at(-1)!.key, 'automate.example')
check('parking and the airline are not subscriptions; parking is offered as one that repeats', [others.map((item) => item.key), others[0]!.charges.length], [['parkpay.example'], 4])

const corrected = gather(charges, NOW, { add: ['parkpay.example'], drop: ['gym.example'] })
check('"זה מנוי" and "זה לא מנוי" are kept', [
  corrected.subscriptions.some((item) => item.key === 'parkpay.example' && item.because === 'you'),
  corrected.subscriptions.some((item) => item.key === 'gym.example'),
  corrected.others.some((item) => item.key === 'gym.example'),
], [true, false, true])

const yearlyPlan = gather([yearly], NOW).subscriptions[0]!
check('a yearly plan costs a twelfth a month', yearlyPlan.monthly, { value: 4, currency: '€' })

check('sums in shekels at given rates', inShekels([{ value: 100, currency: '₪' }, { value: 27, currency: '$' }], { USD: 0.27 }), 200)
check('a currency with no rate gives no total', inShekels([{ value: 750, currency: 'kr' }], { USD: 0.27 }), null)

if (failed) process.exit(1)
