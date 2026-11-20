// Walks Doar's main screens in the demo mailbox ("?demo"), with a hidden browser, a real
// pointer and a real keyboard, and checks what each step leaves on screen. Nothing here
// touches a real mailbox or Doar's server.
//
//   npm run build && npm run preview -- --port 4173 --strictPort      (in one terminal)
//   node --experimental-strip-types scripts/check-ui.ts               (in another)
//
// SITE=http://localhost:5173 checks the dev server instead. SHOTS=some/folder saves pictures.

import { launch, PC, PHONE, sleep, type Page } from '../../../tools/browser.ts'

const SITE = process.env.SITE ?? 'http://localhost:4173'
const SHOTS = process.env.SHOTS

let failed = false
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

/** The demo with its one-time notes put away and no wait before sending, so steps don't depend on timing. */
async function start(page: Page, settings: Record<string, unknown> = {}) {
  await page.waitFor('.thread-row', 25_000)
  await page.evaluate(`localStorage.setItem('doar:settings:demo', ${JSON.stringify(JSON.stringify({ tipsDone: ['demo', 'guide'], undoSendSeconds: 0, ...settings }))})`)
  await page.goto(`${SITE}/?demo=fast`)
  await sleep(400)
  await page.waitFor('.thread-row', 25_000)
  await sleep(300)
}

const toast = (page: Page) => page.text('.toast-text')
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.shot(`${SHOTS}/${name}.png`)
}

const browser = await launch()
try {
  // ================= A phone =================
  const phone = await browser.open(`${SITE}/?demo=fast`, PHONE)
  await start(phone)

  check('the inbox shows the personal letters', (await phone.count('.thread-row')) >= 15, `${await phone.count('.thread-row')} rows`)
  check('other mail is tied in bundles', (await phone.count('.bundle')) >= 3, `${await phone.count('.bundle')} bundles`)
  check('the unread tag counts the inbox', (await phone.text('.filter-count')) === '8', await phone.text('.filter-count'))
  await shot(phone, 'phone-inbox')

  // Reading a letter marks it read.
  await phone.clickText('אישור פגישה ביום שלישי', '.thread-row .row-open')
  await phone.waitFor('.letter iframe')
  check('a letter opens', (await phone.text('.thread-subject')) === 'אישור פגישה ביום שלישי')
  await sleep(500)
  const body = await phone.evaluate<string>(`document.querySelector('.letter iframe').contentDocument.body.innerText`)
  check('its text is shown', body.includes('יום שלישי ב־10:00'), body.slice(0, 40))
  await shot(phone, 'phone-letter')
  await phone.click('.reader-bar .back')
  await phone.waitFor(`!document.querySelector('.thread')`)
  check('opening it marked it read', (await phone.text('.filter-count')) === '7', await phone.text('.filter-count'))

  // Filing with a swipe, and taking it back.
  const before = await phone.count('.thread-row')
  const first = await phone.text('.thread-row .subject')
  await phone.drag('.thread-row', -230, 0)
  await phone.waitFor(`document.querySelectorAll('.thread-row').length === ${before - 1}`)
  check('a swipe files the letter', (await toast(phone)).includes('תויק'), await toast(phone))
  await phone.click('.toast-action')
  await phone.waitFor(`document.querySelectorAll('.thread-row').length === ${before}`)
  check('undo puts it back', (await phone.text('.thread-row .subject')) === first)

  // A long conversation: the quoted letters are folded away, and open on request.
  await phone.clickText('תכנון הטיול לצפון', '.thread-row .row-open')
  await phone.waitFor('.letter iframe')
  await sleep(700)
  const quote = `[...document.querySelectorAll('.letter iframe')].at(-1).contentDocument`
  check('quoted letters are folded behind a tab', (await phone.evaluate<string>(`${quote}.querySelector('.doar-quote-tab')?.getAttribute('aria-expanded')`)) === 'false')
  check('the folded text is hidden', (await phone.evaluate<string>(`getComputedStyle(${quote}.querySelector('.gmail_quote')).display`)) === 'none')
  const shut = await phone.evaluate<number>(`[...document.querySelectorAll('.letter iframe')].at(-1).offsetHeight`)
  await phone.evaluate(`[...document.querySelectorAll('.letter iframe')].at(-1).scrollIntoView({ block: 'center' })`)
  await sleep(500)
  const tab = await phone.evaluate<{ x: number; y: number }>(`(() => {
    const frame = [...document.querySelectorAll('.letter iframe')].at(-1)
    const outer = frame.getBoundingClientRect()
    const inner = frame.contentDocument.querySelector('.doar-quote-tab').getBoundingClientRect()
    return { x: outer.left + inner.left + inner.width / 2, y: outer.top + inner.top + inner.height / 2 }
  })()`)
  await phone.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tab] })
  await phone.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(300)
  const opened = await phone.evaluate<number>(`[...document.querySelectorAll('.letter iframe')].at(-1).offsetHeight`)
  check('a tap on the tab opens the quote', opened > shut + 40, `${shut}px, then ${opened}px`)
  await phone.click('.reader-bar .back')
  await phone.waitFor(`!document.querySelector('.thread')`)

  // A bundle opens to its letters and can be marked read at once.
  await phone.click('.bundle')
  await phone.waitFor(`document.querySelector('.view-title')?.textContent !== 'דואר נכנס'`)
  await sleep(300)
  check('a bundle opens to its letters', (await phone.count('.thread-row')) >= 3, await phone.text('.view-title'))
  await phone.clickText('לסמן הכל כנקרא', '.filter')
  await sleep(300)
  check('the whole bundle is marked read', (await phone.count('.thread-row[data-unread]')) === 0)
  check('nothing went wrong on the phone', phone.errors.length === 0, phone.errors.join(' | ').slice(0, 300))
  phone.close()

  // ================= A PC =================
  const pc = await browser.open(`${SITE}/?demo=fast`, PC)
  await start(pc)
  await shot(pc, 'pc-inbox')

  // Writing and sending with the keyboard; the demo's people answer.
  await pc.key('c')
  await pc.waitFor('.compose')
  await pc.click('.recipient-input')
  await pc.type('dana@levi.example')
  await pc.key('Enter')
  await pc.click('.field-input')
  await pc.type('בדיקה אוטומטית')
  await pc.click('.editor')
  await pc.type('שלום דנה, מצורף המסמך שביקשת.')
  await shot(pc, 'pc-compose')
  await pc.click('.send-stamp')
  await sleep(300)
  check('a promised file that is missing stops the letter once', (await pc.text('.compose-problem')).includes('שום קובץ לא צורף'), await pc.text('.compose-problem'))
  await pc.click('.send-stamp')
  await pc.waitFor(`!document.querySelector('.compose')`)
  await pc.waitFor(`(document.querySelector('.toast-text')?.textContent ?? '').includes('נשלח')`)
  check('a second press sends it', true)
  await pc.waitFor(`[...document.querySelectorAll('.thread-row .subject')].some((el) => el.textContent.includes('בדיקה אוטומטית'))`, 12_000)
  check('the answer arrives in the inbox', (await pc.text('.thread-row .sender')).includes('דנה'), await pc.text('.thread-row .sender'))

  // Search, and the search remembered.
  await pc.key('/')
  await pc.waitFor('.search-input')
  await pc.type('חשבונית')
  await pc.key('Enter')
  await pc.waitFor('.list[aria-label="חיפוש"] .thread-row')
  const found = await pc.texts('.thread-row .sender')
  check('search finds the bills', found.some((name) => name.includes('חברת החשמל')), found.join(', '))
  await pc.click('[aria-label="סגירת החיפוש"]')
  await pc.click('[aria-label="חיפוש"]')
  await pc.waitFor('.search-input')
  check('the last search is offered again', (await pc.texts('.filters .filter')).includes('חשבונית'))
  await pc.click('[aria-label="סגירת החיפוש"]')
  await pc.waitFor('.list[aria-label="דואר נכנס"] .thread-row')

  // Selecting everything.
  await pc.click('.row-pick')
  await pc.waitFor('.select-count')
  await pc.clickText('הכל', '.link-btn')
  const rows = await pc.count('.thread-row')
  check('"all" selects every letter in the list', (await pc.text('.select-count')) === `${rows} נבחרו`, await pc.text('.select-count'))
  await pc.click('[aria-label="ביטול הבחירה"]')

  // A PDF opens to read.
  await pc.clickText('הצעת מחיר לשיפוץ המטבח', '.thread-row .subject')
  await pc.waitFor('.file-slip')
  await pc.click('.file-slip')
  if (await pc.evaluate<boolean>('navigator.pdfViewerEnabled === true')) {
    await pc.waitFor('.lightbox-doc')
    check('a PDF opens inside Doar', (await pc.evaluate<string>(`document.querySelector('.lightbox-doc').src`)).startsWith('blob:'))
    await shot(pc, 'pc-pdf')
    await pc.key('Escape')
  } else console.log('skip the PDF viewer: this browser has none')

  // Managing labels: rename, recolor, delete.
  await pc.click('[aria-label="ניהול תוויות"]')
  await pc.waitFor('.label-manage')
  await pc.click('[aria-label="עריכת התווית בית"]')
  await pc.waitFor('.label-editor input')
  await pc.click('.label-editor input')
  await pc.type('ה')
  await pc.click('.swatch[aria-label="כחול"]')
  await pc.waitFor(`document.querySelector('.swatch[aria-label="כחול"]')?.getAttribute('aria-checked') === 'true'`)
  await shot(pc, 'pc-labels')
  await pc.clickText('שמירה', '.label-editor .pill-btn')
  await pc.waitFor(`!document.querySelector('.label-editor')`)
  const names = () => pc.texts('.nav-label .nav-name')
  check('a label is renamed', (await names()).some((name) => name.startsWith('בית') && name.length === 4), (await names()).join(', '))
  const renamed = (await names()).find((name) => name.startsWith('בית'))!
  await pc.click(`[aria-label="עריכת התווית ${renamed}"]`)
  await pc.click(`[aria-label="מחיקת התווית ${renamed}"]`)
  await pc.clickText('כן, למחוק את התווית', '.pill-btn')
  await pc.waitFor(`![...document.querySelectorAll('.nav-label .nav-name')].some((el) => el.textContent.startsWith('בית'))`)
  check('a label is deleted', (await toast(pc)).includes('התווית נמחקה'), await toast(pc))
  await pc.key('Escape')

  // Held mail: a letter leaves the inbox, waits, and stands first when the server brings it back.
  const navNames = () => pc.texts('.nav-item .nav-name')
  await pc.clickText('אישור פגישה ביום שלישי', '.thread-row .subject')
  await pc.waitFor('.letter')
  await pc.click('.reader-bar [aria-label="להחזיר אליי במועד אחר"]')
  await pc.waitFor('.presets')
  await shot(pc, 'pc-hold')
  await pc.clickText('מחר בבוקר', '.presets button')
  await pc.waitFor(`[...document.querySelectorAll('.nav-item .nav-name')].some((el) => el.textContent === 'שמורים')`)
  check('a held letter leaves the inbox and says when it returns', (await toast(pc)).includes('יחזור מחר'), await toast(pc))
  await pc.clickText('שמורים', '.nav-item')
  await pc.waitFor('.list[aria-label="שמורים"] .row-slip')
  check('it waits in "held" with its time', (await pc.text('.row-slip')).includes('חוזר מחר'), await pc.text('.row-slip'))
  const heldId = await pc.evaluate<string>(`window.__doarDemo.reminders.find((row) => row.kind === 'hold').thread_id`)
  await pc.evaluate(`window.__doarDemo.due(${JSON.stringify(heldId)})`)
  await pc.clickText('דואר נכנס', '.nav-item')
  await pc.waitFor('.list[aria-label="דואר נכנס"] .row-slip[data-returned]', 12_000)
  check(
    'when its time comes it stands first in the inbox',
    (await pc.text('.day-stamp')) === 'חזרו אליך' && (await pc.text('.thread-row .subject')) === 'אישור פגישה ביום שלישי',
    `${await pc.text('.day-stamp')}: ${await pc.text('.thread-row .subject')}`,
  )
  check('"held" is gone from the menu once nothing waits there', !(await navNames()).includes('שמורים'), (await navNames()).join(', '))

  // Registered mail: a letter nobody answers comes back saying so.
  await pc.key('c')
  await pc.waitFor('.compose')
  await pc.click('.recipient-input')
  await pc.type('michal@quiet.example')
  await pc.key('Enter')
  await pc.click('.field-input')
  await pc.type('הצעה לפגישה')
  await pc.click('.editor')
  await pc.type('היי מיכל, מתי נוח לך להיפגש?')
  await pc.click('.registered-btn')
  await pc.waitFor('.presets')
  await pc.clickText('בעוד 3 ימים', '.presets button')
  await pc.waitFor('.registered-note')
  await shot(pc, 'pc-registered')
  await pc.click('.send-stamp')
  await pc.waitFor(`[...document.querySelectorAll('.nav-item .nav-name')].some((el) => el.textContent === 'ממתינים לתשובה')`, 10_000)
  check('a registered letter is watched for an answer', true)
  const sentId = await pc.evaluate<string>(`window.__doarDemo.reminders.find((row) => row.kind === 'reply' && row.status === 'waiting').thread_id`)
  await pc.evaluate(`window.__doarDemo.due(${JSON.stringify(sentId)})`)
  await pc.waitFor('.list[aria-label="דואר נכנס"] .row-slip[data-returned] .reg-mark', 12_000)
  check('with no answer it comes back and says so', (await pc.text('.row-slip[data-returned]')).includes('עדיין אין תשובה'), await pc.text('.row-slip[data-returned]'))
  await pc.clickText('הצעה לפגישה', '.thread-row .subject')
  await pc.waitFor('.thread-slip[data-returned]')
  await shot(pc, 'pc-no-answer')
  await pc.clickText('לוותר', '.thread-slip button')
  await pc.waitFor(`!document.querySelector('.thread-slip')`)
  check('giving up clears the note', (await pc.evaluate<number>(`window.__doarDemo.reminders.filter((row) => row.kind === 'reply').length`)) === 0)

  // A registered letter that is answered: the registration comes off by itself.
  await pc.key('c')
  await pc.waitFor('.compose')
  await pc.click('.recipient-input')
  await pc.type('dana@levi.example')
  await pc.key('Enter')
  await pc.click('.field-input')
  await pc.type('שאלה קצרה')
  await pc.click('.editor')
  await pc.type('מתי נפגשים?')
  await pc.click('.registered-btn')
  await pc.clickText('מחר', '.presets button')
  await pc.click('.send-stamp')
  await pc.waitFor(`window.__doarDemo.reminders.some((row) => row.kind === 'reply' && row.status === 'answered')`, 12_000)
  await pc.waitFor(`![...document.querySelectorAll('.nav-item .nav-name')].some((el) => el.textContent === 'ממתינים לתשובה')`, 12_000)
  check('an answer takes the registration off by itself', true)

  // An express sender.
  await pc.clickText('תמונות מהשבת', '.thread-row .subject')
  await pc.waitFor('.letter')
  await pc.click('[aria-label="עוד פעולות"]')
  await pc.clickText('אקספרס', '.menu-item')
  await pc.waitFor('.thread-row .express-mark')
  check('a sender marked express shows it in the list', (await pc.evaluate<string>(`window.__doarDemo.marks[0].mark + ' ' + window.__doarDemo.marks[0].match`)) === 'express ruth.mizrahi@family.example')

  // Settings: shared settings reach the server, and a fault report can be sent.
  await pc.clickText('הגדרות', '.nav-item')
  await pc.waitFor('.status-list')
  check('the system status shows the version', /\d{4}-\d\d-\d\d \d\d:\d\d/.test(await pc.text('.status-list dd')), await pc.text('.status-list dd'))
  // Opening hours.
  await pc.clickText('שעות פתיחה', '.check')
  await pc.waitFor('window.__doarDemo.hours !== null', 6000)
  await pc.clickText('סגור בשבת', '.check')
  await pc.waitFor('window.__doarDemo.hours && window.__doarDemo.hours.shabbat === true', 6000)
  const hours = await pc.evaluate<{ from: string; to: string; days: number[]; tz: string }>('window.__doarDemo.hours')
  check('opening hours are saved with the time zone', hours.from === '07:00' && hours.to === '22:00' && hours.days.length === 7 && hours.tz.includes('/'), JSON.stringify(hours))
  await shot(pc, 'pc-hours')

  await pc.clickText('10 שניות', '.segments button')
  await pc.waitFor('window.__doarDemo.prefs && window.__doarDemo.prefs.undoSendSeconds === 10', 6000)
  check('a changed setting is saved for all devices', true)
  await pc.clickText('שליחת דוח תקלה', '.pill-btn')
  await pc.waitFor(`window.__doarDemo.reports.some((report) => report.place === 'settings.manual')`, 6000)
  const reports = await pc.evaluate<{ place: string; message: string; version: string; device: string }[]>('window.__doarDemo.reports')
  const sent = reports.find((report) => report.place === 'settings.manual')!
  check('a fault report is sent', sent.version.length > 10 && sent.device.includes('מחשב'), JSON.stringify(sent).slice(0, 120))
  const others = reports.filter((report) => report !== sent)
  check('no fault was reported by itself along the way', others.length === 0, others.map((report) => `${report.place}: ${report.message}`).join(' | ').slice(0, 400))
  check('on a PC, Settings say the widget is connected from the phone', (await pc.text('#widget-settings')).includes('מהטלפון'))
  await shot(pc, 'pc-settings')
  await pc.key('Escape')

  check('nothing went wrong on the PC', pc.errors.length === 0, pc.errors.join(' | ').slice(0, 300))
  pc.close()

  // ================= Kinds of mail, return to sender, the inspector (a PC, from a fresh start) =================
  const desk = await browser.open(`${SITE}/?demo=fast`, PC)
  await start(desk)
  // The counter fills in a moment after the list (its letters come with the bundles).
  await desk.waitFor('.queue-ticket')
  await sleep(700)
  const settings = () => desk.evaluate<{ notKinds: Record<string, string[]>; trusted: string[] }>(`JSON.parse(localStorage.getItem('doar:settings:demo'))`)
  const frameText = (selector: string) => desk.evaluate<string>(`[...document.querySelectorAll('.letter iframe')].at(-1).contentDocument.querySelector(${JSON.stringify(selector)})?.outerHTML ?? ''`)
  const toInbox = async () => {
    await desk.clickText('דואר נכנס', '.nav-item')
    await desk.waitFor('.list[aria-label="דואר נכנס"] .thread-row')
  }

  // The counter: a fresh code as a queue ticket, and the parcels on their way.
  check('a fresh code stands on the counter as a queue ticket', (await desk.text('.queue-ticket .qt-digits')) === '482 913', await desk.text('.queue-ticket .qt-digits'))
  // A hidden browser never answers the clipboard's permission question, so the clipboard is stood in for.
  await desk.evaluate(`(Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => ((window.__copied = text), Promise.resolve()) } }), 0)`)
  await desk.click('.qt-copy')
  await desk.waitFor(`!!document.querySelector('.toast-text')`)
  check('one press copies it, and says its letter will go to the bin', (await toast(desk)).startsWith('הקוד הועתק. בעוד רבע שעה') && (await desk.evaluate<string>('window.__copied')) === '482913', `${await toast(desk)}: ${await desk.evaluate<string>('window.__copied')}`)
  // Measured on the page's own clock (a run with CLOCK set has its own idea of "now").
  const codeDue = await desk.evaluate<number>(`(Object.values(JSON.parse(localStorage.getItem('doar:copied-codes:demo') ?? '{}'))[0] ?? 0) - Date.now()`)
  check('the letter is due in the bin a quarter of an hour from now', Math.abs(codeDue - 15 * 60_000) < 60_000, String(codeDue))
  check('parcels on their way are counted', (await desk.text('.parcel-strip-head')).includes('2 חבילות בדרך'), await desk.text('.parcel-strip-head'))
  await desk.click('.parcel-strip-head')
  await desk.waitFor('.parcel-list')
  check('and listed, each with its number', (await desk.texts('.parcel-list .parcel-number')).includes('RR123456789IL'), (await desk.texts('.parcel-list .parcel-number')).join(', '))
  await shot(desk, 'pc-counter')
  await desk.click('.parcel-strip-head')

  // In a bundle, each kind is the object it is.
  await desk.clickText('עדכונים', '.bundle')
  await desk.waitFor('.list[aria-label="עדכונים"] .thread-row')
  const kinds = await desk.evaluate<string[]>(`[...document.querySelectorAll('.thread-row')].map((row) => row.dataset.kind ?? 'letter')`)
  check('codes, parcels and receipts are told apart in the list', ['code', 'parcel', 'receipt'].every((kind) => kinds.includes(kind)), kinds.join(', '))
  check('a receipt shows its sum at its edge', (await desk.text('.thread-row[data-kind="receipt"] .kind-tag')).includes('128.00'), await desk.text('.thread-row[data-kind="receipt"] .kind-tag'))
  check('a code shows its digits, with a button that copies them', (await desk.text('.thread-row[data-kind="code"] .code-digits')) === '482 913' && (await desk.count('.thread-row[data-kind="code"] .row-copy')) === 1)
  await shot(desk, 'pc-kinds')

  // A parcel, open: the delivery slip; and the correction "this is not a parcel".
  await desk.clickText('החבילה שלך ממתינה לאיסוף', '.thread-row .subject')
  await desk.waitFor('.kind-card[data-kind="parcel"]')
  const slip = await desk.text('.kind-card')
  const track = await desk.evaluate<string>(`document.querySelector('.kind-card a.kind-action')?.href ?? ''`)
  check('an open parcel is a delivery slip', slip.includes('ממתינה לאיסוף') && slip.includes('RR123456789IL') && track.includes('zariz-delivery.example/track'), `${slip.slice(0, 80)} | ${track}`)
  await shot(desk, 'pc-parcel')
  await desk.clickText('זה לא חבילה', '.kind-not')
  await desk.waitFor(`!document.querySelector('.kind-card')`)
  check('"this is not a parcel" is remembered for the sender', JSON.stringify((await settings()).notKinds['updates@zariz-delivery.example']) === '["parcel"]', JSON.stringify((await settings()).notKinds))
  await desk.waitFor(`!!(window.__doarDemo.prefs?.notKinds?.['updates@zariz-delivery.example'])`, 6000)
  check('and kept for every device', true)
  await desk.click('.toast-action')
  await desk.waitFor('.kind-card[data-kind="parcel"]')
  check('undo brings the slip back', Object.keys((await settings()).notKinds).length === 0)

  // A receipt, open.
  await desk.clickText('קבלה על הזמנה 10482', '.thread-row .subject')
  await desk.waitFor('.kind-card[data-kind="receipt"]')
  check('an open receipt shows its total', (await desk.text('.receipt-sum')).includes('128.00'), await desk.text('.receipt-sum'))
  // Its button goes to all the receipts. It does not file the letter: the letter stays open, in the inbox.
  await desk.clickText('כל הקבלות', '.kind-card .kind-action')
  await desk.waitFor('.spike-month')
  check('from a receipt, "all the receipts" opens the spike over the letter', (await desk.text('.sheet h2')) === 'דוקרן הקבלות' && (await desk.text('.thread-subject')) === 'קבלה על הזמנה 10482')
  await desk.key('Escape')
  await desk.waitFor(`!document.querySelector('.sheet')`)
  check('and the letter was not filed', (await desk.count('.kind-card[data-kind="receipt"]')) === 1 && (await desk.evaluate<boolean>(`[...document.querySelectorAll('.thread-row .subject')].some((el) => el.textContent === 'קבלה על הזמנה 10482')`)))

  // An invitation, open: the day, the hour, and the way to the calendar.
  await toInbox()
  await desk.clickText('הזמנה: ישיבת צוות', '.thread-row .subject')
  await desk.waitFor('.kind-card[data-kind="invitation"]')
  const meeting = new Date()
  meeting.setDate(meeting.getDate() + 3)
  const calendar = await desk.evaluate<string>(`document.querySelector('.kind-card a.kind-action')?.href ?? ''`)
  check(
    'an invitation is a card with its day, and leads to the calendar',
    (await desk.text('.invite-day')) === String(meeting.getDate()) && (await desk.text('.kind-title')) === 'ישיבת צוות' && calendar.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'),
    `${await desk.text('.invite-day')} ${await desk.text('.kind-title')} ${calendar.slice(0, 60)}`,
  )
  check('an invitation is marked in the list', (await desk.count('.thread-row[data-kind="invitation"] .kind-tag')) === 1)
  await shot(desk, 'pc-invitation')

  // The inspector: a verified sender, and a letter that pretends to be the bank.
  await desk.clickText('אישור פגישה ביום שלישי', '.thread-row .subject')
  await desk.waitFor('.seal-line')
  check('a verified sender carries an intact seal', (await desk.evaluate<string>(`document.querySelector('.seal-line').dataset.state`)) === 'intact')
  await desk.clickText('חשבונך הוגבל', '.thread-row .subject')
  await desk.waitFor('.inspect-strip')
  const strip = await desk.text('.inspect-strip')
  check(
    'a letter that pretends to be the bank is flagged',
    (await desk.evaluate<string>(`document.querySelector('.inspect-strip').dataset.level`)) === 'warning' && strip.includes('לא הצליח לאמת') && strip.includes('בנק הדוגמה') && (await desk.evaluate<string>(`document.querySelector('.seal-line').dataset.state`)) === 'broken',
    strip.slice(0, 140),
  )
  await sleep(400)
  await desk.evaluate(`[...document.querySelectorAll('.letter iframe')].at(-1).contentDocument.querySelector('a').click()`)
  await desk.waitFor('.link-slip')
  check('its link says where it really leads before it opens', (await desk.text('.link-slip-text')).includes('bank-dugma-login.example') && (await desk.text('.link-slip-text')).includes('www.bank-dugma.example'), await desk.text('.link-slip-text'))
  await shot(desk, 'pc-inspector')
  await desk.clickText('לא לפתוח', '.link-slip button')
  await desk.waitFor(`!document.querySelector('.link-slip')`)

  // A leaflet: its tracking mark is taken out, and it can be returned to its sender.
  await desk.clickText('פרסומות', '.bundle')
  await desk.waitFor('.list[aria-label="פרסומות"] .thread-row')
  check('promotions are thin leaflets', (await desk.count('.thread-row[data-kind="leaflet"]')) >= 2)
  await desk.clickText('מבצעי סוף העונה', '.thread-row .subject')
  await desk.waitFor('.marks-note')
  await sleep(400)
  check('a tracking mark is taken out of the letter', (await desk.text('.marks-note')) === 'הוסר סימן מעקב אחד' && (await frameText('img[src*="open.gif"]')) === '' && (await frameText('a')) !== '', await desk.text('.marks-note'))
  await desk.click('.ticket-return')
  await desk.waitFor('.returned-stamp')
  check('"return to sender" stamps the letter and waits', (await toast(desk)).includes('הוחזר לשולח') && (await desk.evaluate<number>('window.__doarDemo.marks.length')) === 0, await toast(desk))
  await shot(desk, 'pc-returned')
  await desk.click('.toast-action')
  await desk.waitFor(`!document.querySelector('.returned-stamp')`)
  await sleep(300)
  check('undo takes the stamp off, and nothing was sent', (await desk.evaluate<number>('window.__doarDemo.marks.length')) === 0)
  await desk.click('.ticket-return')
  await desk.waitFor(`window.__doarDemo.marks.some((mark) => mark.mark === 'refused' && mark.match === 'news@naalayim.example')`, 12_000)
  await desk.waitFor(`![...document.querySelectorAll('.thread-row .subject')].some((el) => el.textContent.includes('מבצעי סוף העונה'))`, 6000)
  check('left alone, the sender is refused and the letter goes to the bin', true)

  // A sender's card, from the stamp on the envelope.
  await toInbox()
  await desk.clickText('תמונות מהשבת', '.thread-row .subject')
  await desk.waitFor('.stamp-btn')
  await desk.click('.stamp-btn')
  await desk.waitFor('.person-head')
  check('the stamp on an envelope opens the sender\'s card', (await desk.text('.person-addr')).includes('ruth.mizrahi@family.example'), await desk.text('.person-addr'))
  await desk.waitFor('.person-count', 6000)
  await shot(desk, 'pc-person')
  // Refusing a sender from their card takes two presses.
  await desk.clickText('החזר לשולח', '.person-mark')
  await sleep(200)
  check('refusing a sender from their card asks first', (await desk.text('.person-mark[data-tone="red"] strong')).includes('לחיצה נוספת') && !(await desk.evaluate<boolean>(`window.__doarDemo.marks.some((mark) => mark.mark === 'refused' && mark.match === 'ruth.mizrahi@family.example')`)))
  await desk.click('.person-name')
  await sleep(200)
  check('and looking away takes the question back', (await desk.text('.person-mark[data-tone="red"] strong')) === 'החזר לשולח')
  await desk.clickText('כל המכתבים', '.person-action')
  await desk.waitFor('.list[aria-label="חיפוש"] .thread-row')
  check('"all letters" lists the mail with them', (await desk.texts('.thread-row .subject')).some((subject) => subject.includes('תמונות מהשבת')))
  await desk.click('[aria-label="סגירת החיפוש"]')
  await desk.waitFor('.list[aria-label="דואר נכנס"] .thread-row')

  // A note on a letter: yours alone, shown on the letter and marked in the list.
  await desk.clickText('תמונות מהשבת', '.thread-row .subject')
  await desk.waitFor('.letter')
  await desk.click('[aria-label="עוד פעולות"]')
  await desk.clickText('פתק על המכתב', '.menu-item')
  await desk.waitFor('textarea.note-text')
  await desk.type('להתקשר לאמא ביום שישי')
  await desk.clickText('שמירה', '.note-actions button')
  await desk.waitFor('.note-read')
  check('a note is clipped to the letter', (await desk.text('.note-read')) === 'להתקשר לאמא ביום שישי', await desk.text('.note-read'))
  check('and its corner shows in the list', (await desk.count('.thread-row[aria-current="true"] .note-corner')) === 1)
  await shot(desk, 'pc-note')
  await desk.click('.note-read')
  await desk.waitFor('textarea.note-text')
  await desk.clickText('להסיר את הפתק', '.note-actions button')
  await desk.waitFor(`!document.querySelector('.note-slip')`)
  check('a note can be taken off', (await desk.count('.note-corner')) === 0)

  // On a PC: "לאן?" by Ctrl+K, a letter's menu by a right click, and dragging a letter onto a label.
  await desk.key('Control+k')
  await desk.waitFor('.palette input')
  await desk.type('משפ')
  await sleep(150)
  check('"לאן?" finds a label by a few letters', (await desk.text('.palette-list li[aria-selected="true"]')).includes('משפחה'), await desk.text('.palette-list li[aria-selected="true"]'))
  await shot(desk, 'pc-palette')
  await desk.key('Enter')
  await desk.waitFor('.list[aria-label="משפחה"] .thread-row')
  check('and Enter goes there', (await desk.text('.view-title')) === 'משפחה')
  await desk.key('Control+k')
  await desk.waitFor('.palette input')
  await desk.type('דוקרן')
  await sleep(150)
  await desk.key('Enter')
  await desk.waitFor('.spike-month')
  check('"לאן?" also runs actions', true)
  await desk.key('Escape')
  await desk.waitFor(`!document.querySelector('.sheet')`)
  await toInbox()

  await desk.evaluate(`[...document.querySelectorAll('.thread-row')].find((el) => el.textContent.includes('מסמכים לדוח השנתי')).scrollIntoView({ block: 'center' })`)
  await sleep(400)
  const rowPoint = await desk.evaluate<{ x: number; y: number }>(`(() => { const row = [...document.querySelectorAll('.thread-row')].find((el) => el.textContent.includes('מסמכים לדוח השנתי')).getBoundingClientRect(); return { x: row.left + row.width / 2, y: row.top + row.height / 2 } })()`)
  await desk.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowPoint.x, y: rowPoint.y })
  await desk.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rowPoint.x, y: rowPoint.y, button: 'right', buttons: 2, clickCount: 1 })
  await desk.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rowPoint.x, y: rowPoint.y, button: 'right', buttons: 0, clickCount: 1 })
  await desk.waitFor('.menu-floating')
  const menuItems = await desk.texts('.menu-floating .menu-item')
  check('a right click opens the letter\'s menu', menuItems.includes('לתיוק') && menuItems.includes('תוויות') && menuItems.includes('לפח'), menuItems.join(', '))
  await shot(desk, 'pc-row-menu')
  const starred = () => desk.evaluate<boolean>(`[...document.querySelectorAll('.thread-row')].find((el) => el.textContent.includes('מסמכים לדוח השנתי')).querySelector('.star-mark') !== null`)
  const hadStar = await starred()
  await desk.clickText('כוכב', '.menu-floating .menu-item')
  await desk.waitFor(`!document.querySelector('.menu-floating')`)
  await sleep(200)
  check('and its items act on that letter', (await starred()) === !hadStar)

  // Dragging: the browser's own drag cannot be driven from here, so its events are sent as it would send them.
  const label = `[...document.querySelectorAll('.nav-label')].find((el) => el.textContent.includes('חשבונות'))`
  await desk.evaluate(`(() => {
    const row = [...document.querySelectorAll('.thread-row')].find((el) => el.textContent.includes('מסמכים לדוח השנתי'))
    window.__drag = { row, data: new DataTransfer() }
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__drag.data }))
  })()`)
  await desk.waitFor(`${label}.dataset.drop === 'ready'`)
  await desk.evaluate(`${label}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__drag.data }))`)
  await desk.waitFor(`${label}.dataset.drop === 'over'`)
  const dropped = await desk.evaluate<string>(`(() => {
    const target = ${label}
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__drag.data }))
    window.__drag.row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__drag.data }))
    return window.__drag.data.getData('application/x-doar-letters')
  })()`)
  await desk.waitFor(`[...document.querySelectorAll('.thread-row')].find((el) => el.textContent.includes('מסמכים לדוח השנתי'))?.querySelector('.tape') !== null`)
  check('a letter dragged onto a label gets it, and the label shows where to drop', dropped.startsWith('["') && (await toast(desk)).includes('חשבונות'), `${dropped} · ${await toast(desk)}`)

  // Small things: the Hebrew date on an open letter, and larger text in letters.
  await desk.clickText('הגדרות', '.nav-item')
  await desk.waitFor('.status-list')
  await desk.clickText('התאריך העברי', '.check')
  await desk.clickText('גדול מאוד', '.segments button')
  await desk.key('Escape')
  await desk.waitFor(`!document.querySelector('.sheet')`)
  await desk.clickText('תמונות מהשבת', '.thread-row .subject')
  await desk.waitFor('.envelope-hebrew')
  await sleep(500)
  const letterFont = await desk.evaluate<string>(`getComputedStyle([...document.querySelectorAll('.letter iframe')].at(-1).contentDocument.body).fontSize`)
  check('the Hebrew date stands beside the date, and the text of the letter is larger', /ב\S+ תשפ״[א-ת]/.test(await desk.text('.envelope-hebrew')) && letterFont === '21px', `${await desk.text('.envelope-hebrew')} · ${letterFont}`)

  // The files drawer: what came by mail, by kind; a press goes to the letter.
  await desk.clickText('מגירת הקבצים', '.nav-item')
  await desk.waitFor('.drawer-file')
  await desk.waitFor(`document.querySelectorAll('.drawer-file').length >= 4`, 12_000)
  const fileNames = () => desk.texts('.drawer-file .file-name')
  check('the files drawer shows the files that came by mail', (await fileNames()).includes('הצעת-מחיר-מטבח.pdf') && (await fileNames()).some((name) => name.endsWith('.jpg')), (await fileNames()).slice(0, 5).join(', '))
  await shot(desk, 'pc-files')
  await desk.clickText('תמונות', '.drawer-sorts button')
  await sleep(200)
  check('and sorts them by kind', (await fileNames()).length >= 2 && (await fileNames()).every((name) => /\.(jpg|png)$/.test(name)), (await fileNames()).join(', '))
  await desk.click('.drawer-file')
  await desk.waitFor(`!document.querySelector('.sheet')`)
  await desk.waitFor('.letter')
  check('a file leads to its letter', (await desk.text('.thread-subject')) === 'תמונות מהשבת', await desk.text('.thread-subject'))

  // Search in plain words: a chip writes a piece of the search, and takes it off again.
  await desk.key('/')
  await desk.waitFor('.search-input')
  await desk.type('הצעת')
  await desk.key('Enter')
  await desk.waitFor('.list[aria-label="חיפוש"] .thread-row')
  await desk.clickText('עם קובץ', '.search-chip')
  await desk.waitFor(`document.querySelector('.search-input').value === 'הצעת has:attachment'`)
  await desk.waitFor('.list[aria-label="חיפוש"] .thread-row')
  const withFile = await desk.texts('.thread-row .subject')
  check('a search chip writes its piece of the search', withFile.length >= 1 && withFile.every((subject) => subject.includes('הצעת')) && (await desk.evaluate<string>(`document.querySelector('.search-chip[aria-pressed="true"]').textContent`)) === 'עם קובץ', withFile.join(' | '))
  await desk.clickText('עם קובץ', '.search-chip')
  await desk.waitFor(`document.querySelector('.search-input').value === 'הצעת'`)
  check('and takes it off again', (await desk.count('.search-chip[aria-pressed="true"]')) === 0)
  await desk.click('[aria-label="סגירת החיפוש"]')
  await desk.waitFor('.list[aria-label="דואר נכנס"] .thread-row')

  // The lamp's chain switches day and night.
  const theme = () => desk.evaluate<string>('document.documentElement.dataset.theme')
  const day = await theme()
  await desk.click('.lamp-chain')
  await sleep(150)
  const night = await theme()
  await shot(desk, 'pc-night')
  await desk.click('.lamp-chain')
  await sleep(150)
  check('the lamp chain switches day and night', night !== day && (await theme()) === day, `${day} → ${night} → ${await theme()}`)

  // The stamp album and the receipts spike, from the menu.
  await desk.clickText('אלבום הבולים', '.nav-item')
  await desk.waitFor('.album-stamp')
  check('the album shows the people you exchange mail with', (await desk.count('.album-stamp')) >= 5, `${await desk.count('.album-stamp')} stamps`)
  await shot(desk, 'pc-album')
  await desk.click('.album-stamp')
  await desk.waitFor('.person-head')
  check('a stamp in the album opens that person\'s card', true)
  await desk.key('Escape')
  await desk.waitFor(`!document.querySelector('.sheet')`)
  await desk.clickText('דוקרן הקבלות', '.nav-item')
  await desk.waitFor('.spike-month')
  const sums = (await desk.texts('.spike-sum')).join(' | ')
  const amounts = (await desk.texts('.spike-amount')).join(' | ')
  check('the spike gathers receipts by month, with a sum', amounts.includes('128.00') && amounts.includes('342.50') && /\d/.test(sums), `${sums} / ${amounts}`)
  await shot(desk, 'pc-spike')
  // Subscriptions, from the spike: found in the receipts, added up, and corrected both ways.
  await desk.clickText('מה מתוכן מנויים?', '.spike-subs')
  await desk.waitFor('.subs-ledger')
  await desk.waitFor(`!document.querySelector('.subs-ledger').textContent.includes('עוד קוראים')`, 30_000)
  const subscribed = await desk.texts('.subs-card .subs-what strong')
  check(
    'subscriptions are found by their words, by their pace and by a billing period',
    ['Notely', 'סטרים פלוס', 'Gym Hayarkon', 'Cloudbox', 'Automate'].every((name) => subscribed.includes(name)) && !subscribed.includes('חנות הספרים'),
    subscribed.join(' | '),
  )
  const ledger = await desk.text('.subs-ledger')
  check('the year and the month are added up, in shekels about', /בערך [\d,]+ ₪/.test(ledger) && ledger.includes('$') && ledger.includes('5 מנויים פעילים'), ledger)
  check('one that stopped charging is set apart', (await desk.text('.subs-list[aria-label="מנויים שנראה שהסתיימו"]')).includes('Automate'))
  check('the next charge of a monthly one is a month after the last', (await desk.text('.subs-card:has(.subs-what strong) .subs-line')).includes('החיוב הבא'))
  await desk.clickText('Gym Hayarkon', '.subs-what strong')
  await desk.waitFor('.subs-receipts')
  check('a subscription shows its receipts', (await desk.count('.subs-receipts li')) === 4, String(await desk.count('.subs-receipts li')))
  await desk.clickText('זה לא מנוי', '.subs-not')
  await desk.waitFor(`![...document.querySelectorAll('.subs-what strong')].some((name) => name.textContent === 'Gym Hayarkon')`)
  await desk.clickText('זה מנוי', '.subs-others .pill-btn')
  await desk.waitFor(`[...document.querySelectorAll('.subs-what strong')].some((name) => name.textContent === 'Gym Hayarkon')`)
  await desk.waitFor(`JSON.stringify(window.__doarDemo.prefs?.subscriptions ?? null).includes('gym-hayarkon.example')`, 8000)
  check('"זה לא מנוי" takes it out, "זה מנוי" brings it back, for every device', true)
  await shot(desk, 'pc-subscriptions')
  await desk.key('Escape')

  // A quarter of an hour on (moved forward here), the copied code's letter goes to the bin.
  await desk.key('Escape')
  await toInbox()
  await desk.evaluate(`(() => {
    const key = 'doar:copied-codes:demo'
    const codes = JSON.parse(localStorage.getItem(key) ?? '{}')
    for (const id of Object.keys(codes)) codes[id] = Date.now() - 1000
    localStorage.setItem(key, JSON.stringify(codes))
    window.__doarCodes()
  })()`)
  await desk.waitFor(`!!document.querySelector('.toast-text')`)
  const binned = await toast(desk)
  check('a quarter of an hour after its code was copied, the letter goes to the bin', binned.startsWith('קוד שהעתקתם הועבר לאשפה') && (await desk.count('.queue-ticket')) === 0, binned)
  check('and it is not binned twice', (await desk.evaluate<string>(`localStorage.getItem('doar:copied-codes:demo')`)) === '{}')

  const strays = await desk.evaluate<{ place: string; message: string }[]>('window.__doarDemo.reports')
  check('no fault was reported along the way', strays.length === 0, strays.map((report) => `${report.place}: ${report.message}`).join(' | ').slice(0, 400))
  check('nothing went wrong at the desk', desk.errors.length === 0, desk.errors.join(' | ').slice(0, 300))
  desk.close()

  // ================= Opening the mail, one card at a time (a phone, from a fresh start) =================
  const rite = await browser.open(`${SITE}/?demo=fast`, PHONE)
  await start(rite)
  await rite.waitFor('.postman-strip')
  await sleep(600)
  check('with unread mail, the postman offers to open it one by one', (await rite.text('.postman-strip')).includes('הדוור הביא 8 מכתבים'), await rite.text('.postman-strip'))
  await shot(rite, 'phone-postman')
  await rite.click('.postman-strip')
  await rite.waitFor('.ritual-card-holder')
  await sleep(400)
  const riteSubject = () => rite.text('.ritual-card-holder .ritual-card-subject')
  const riteLeft = () => rite.text('.ritual-count')
  const ticket = (name: string) => rite.clickText(name, '.ritual-tickets .ticket')
  const nextLetter = async (after: string) => rite.waitFor(`(document.querySelector('.ritual-card-holder .ritual-card-subject')?.textContent ?? '') !== ${JSON.stringify(after)} || !!document.querySelector('.clear-desk')`)
  check('the first card is a letter from a person, still unread', (await riteSubject()) === 'אישור פגישה ביום שלישי' && (await riteLeft()).includes('8') && (await rite.count('.thread-row')) >= 0, `${await riteSubject()} · ${await riteLeft()}`)
  check('the next card shows under it', (await rite.count('.ritual-card[data-under]')) === 1)
  await shot(rite, 'phone-ritual')

  // A swipe to the left files the letter.
  let shown = await riteSubject()
  await rite.drag('.ritual-card-holder', -260, 6, 0, 16)
  await nextLetter(shown)
  check('swiping a card to the left files it and brings the next', (await riteLeft()).includes('7') && (await riteSubject()) !== shown && (await toast(rite)) === 'המכתב תויק', `${await riteSubject()} · ${await riteLeft()} · ${await toast(rite)}`)

  // Undo brings the card back.
  await rite.clickText('ביטול', '.toast-action')
  await rite.waitFor(`(document.querySelector('.ritual-card-holder .ritual-card-subject')?.textContent ?? '') === ${JSON.stringify(shown)}`)
  check('undo brings the filed card back on top', (await riteLeft()).includes('8'))

  // A swipe that is not far enough puts the card back.
  await rite.drag('.ritual-card-holder', -40, 0, 0, 6)
  await sleep(500)
  check('a short swipe changes nothing', (await riteSubject()) === shown && (await riteLeft()).includes('8'))

  // Pressing the card opens the whole letter; Back returns to the card.
  await rite.click('.ritual-card-holder')
  await rite.waitFor('.ritual .letter iframe')
  check('pressing a card opens the whole letter, with no bar of its own', (await rite.text('.ritual .thread-subject')) === shown && (await rite.evaluate<string>(`getComputedStyle(document.querySelector('.ritual .reader-bar')).display`)) === 'none')
  await rite.click('.ritual-bar .icon-btn')
  await rite.waitFor('.ritual-card-holder')
  check('and the arrow goes back to the cards', (await riteSubject()) === shown)

  await rite.drag('.ritual-card-holder', -260, 6, 0, 16)
  await nextLetter(shown)

  // A swipe to the right marks it read and keeps it in the inbox.
  shown = await riteSubject()
  const kept = shown
  await rite.drag('.ritual-card-holder', 260, 6, 0, 16)
  await nextLetter(shown)
  check('swiping a card to the right marks it read and moves on', (await riteLeft()).includes('6'), await riteLeft())

  shown = await riteSubject()
  await ticket('אחר כך')
  await rite.waitFor('.presets')
  await rite.clickText('מחר בבוקר', '.presets button')
  await nextLetter(shown)
  check('"later" holds the letter and moves on', (await riteLeft()).includes('5') && (await rite.evaluate<number>(`window.__doarDemo.reminders.filter((row) => row.kind === 'hold').length`)) === 1, await riteLeft())

  shown = await riteSubject()
  await ticket('לפח')
  await nextLetter(shown)
  check('"bin" bins the letter and moves on', (await riteLeft()).includes('4'), await riteLeft())

  // The rest: bundled letters are cards of their own, each with its bundle's tag.
  let sawBundled = false
  for (let step = 0; step < 20 && !(await rite.count('.clear-desk')); step++) {
    if (!sawBundled && (await rite.count('.ritual-card-holder .bundle-tag'))) {
      sawBundled = true
      await shot(rite, 'phone-ritual-bundled')
    }
    await ticket('לתיוק')
    await sleep(350)
  }
  check('a letter from a bundle is a card of its own, with its bundle’s tag', sawBundled)
  await rite.waitFor('.clear-desk')
  await sleep(1500)
  const clear = await rite.text('.clear-text')
  check('after the last letter the desk is clear, and says what returns tomorrow', clear.includes('השולחן נקי') && clear.includes('מכתב שמור אחד יחזור מחר') && (await rite.text('.clear-stamp-top')) === 'אין דואר', clear)
  await shot(rite, 'phone-clear-desk')
  await rite.clickText('חזרה לשולחן', '.pill-btn')
  await rite.waitFor(`!document.querySelector('.ritual')`)
  const remaining = await rite.texts('.thread-row .subject')
  check('the letter that was kept is still in the inbox, read', remaining.includes(kept) && (await rite.count('.thread-row[data-unread]')) === 0 && (await rite.count('.postman-strip')) === 0, remaining.slice(0, 4).join(' | '))
  check('nothing went wrong in the ritual', rite.errors.length === 0, rite.errors.join(' | ').slice(0, 300))
  rite.close()

  // ================= The guide: what Doar can do (a phone at night, from a fresh start) =================
  const book = await browser.open(`${SITE}/?demo=fast`, { ...PHONE, dark: true })
  await start(book, { tipsDone: ['demo'] })
  await book.waitFor('.tip')
  check('a note at the top of the inbox offers the guide', (await book.text('.tip')).includes('מה דואר יודע לעשות'), await book.text('.tip'))
  await book.clickText('לקרוא', '.tip-actions button')
  await book.waitFor('.guide-book')
  await sleep(600)
  const guideRows = await book.count('.guide-row')
  check('the guide gives every thing one row, with its picture', guideRows >= 25 && (await book.count('.guide-row .guide-art > *')) === guideRows && (await book.count('.guide-small > div')) >= 15, `${guideRows} rows, ${await book.count('.guide-small > div')} small ones`)
  check('a row is a name and one short line', (await book.text('[aria-controls="guide-more-hold"] .guide-name')) === 'דואר שמור' && (await book.text('[aria-controls="guide-more-hold"] .guide-plain')) === 'מכתב שחוזר אליכם במועד שבחרתם.')
  const guideFits = await book.evaluate<boolean>(`(() => {
    const body = document.querySelector('.guide-body')
    const box = document.querySelector('.guide-book').getBoundingClientRect()
    return body.scrollWidth <= body.clientWidth && box.left >= 0 && box.right <= innerWidth
  })()`)
  check('it fits a phone, with nothing to scroll sideways', guideFits)
  await shot(book, 'phone-guide')

  await book.click('[aria-controls="guide-more-hold"]')
  await book.waitFor('#guide-more-hold')
  const more = await book.text('#guide-more-hold')
  check('a row opens to say how and why', more.includes('איך') && more.includes('שעון החול') && more.includes('למה') && more.includes('התיבה מראה רק'), more.slice(0, 70))
  await shot(book, 'phone-guide-open')
  await book.click('[aria-controls="guide-more-ticket"]')
  await book.waitFor('#guide-more-ticket')
  check('one row is open at a time', (await book.count('.guide-more')) === 1)

  // The opened row has been brought into view; the page stands still before the next press.
  await sleep(700)
  await book.clickText('מחפשים', '.guide-tabs .filter')
  await book.waitFor(`document.querySelector('.guide-tabs [aria-current]')?.textContent === 'מחפשים'`)
  const reading = await book.evaluate<boolean>(`(() => {
    const body = document.querySelector('.guide-body').getBoundingClientRect()
    const title = document.querySelector('#guide-finding h3').getBoundingClientRect()
    return title.top >= body.top - 2 && title.top < body.top + 120
  })()`)
  check('a chapter\u2019s tag jumps to the chapter', reading)

  // A row can take the reader to the thing itself; the guide waits under it.
  await book.click('[aria-controls="guide-more-album"]')
  await book.waitFor('#guide-more-album .guide-try')
  await book.click('#guide-more-album .guide-try')
  await book.waitFor('.album-stamp')
  check('a row opens the thing it is about', (await book.count('.album-stamp')) >= 5)
  await book.click('.sheet .icon-btn')
  await book.waitFor(`!document.querySelector('.sheet')`)
  check('closing it goes back to the guide, where the reading stopped', (await book.count('#guide-more-album')) === 1)
  await book.click('[aria-controls="guide-more-lamp"]')
  await book.waitFor('#guide-more-lamp .guide-try')
  await book.click('#guide-more-lamp .guide-try')
  await book.waitFor(`document.documentElement.dataset.theme === 'light'`)
  check('the lamp chain can be pulled from the guide, which stays open', (await book.count('.guide-book')) === 1)
  await book.click('#guide-more-lamp .guide-try')
  await book.waitFor(`document.documentElement.dataset.theme === 'dark'`)
  await book.click('.guide-head .icon-btn')
  await book.waitFor(`!document.querySelector('.guide-book')`)
  check('the note about the guide is shown once', !(await book.text('.tip')).includes('מה דואר יודע'), await book.text('.tip'))

  // Forms stay inside the screen whatever is written in them (the demo has a receipt with a very long subject).
  const openFromMenu = async (name: string) => {
    await book.click('[aria-label="תיקיות ותוויות"]')
    await sleep(350)
    await book.clickText(name, '.nav-item')
    await book.waitFor('.sheet')
  }
  const formFits = () =>
    book.evaluate<boolean>(`(() => {
      const sheet = document.querySelector('.sheet').getBoundingClientRect()
      const close = document.querySelector('.sheet .icon-btn').getBoundingClientRect()
      const body = document.querySelector('.sheet-body')
      return sheet.left >= 0 && sheet.right <= innerWidth && close.left >= 0 && close.right <= innerWidth && body.scrollWidth <= body.clientWidth
    })()`)
  const closeForm = async () => {
    await book.click('.sheet .icon-btn')
    await book.waitFor(`!document.querySelector('.sheet')`)
  }
  await openFromMenu('דוקרן הקבלות')
  await book.waitFor(`document.querySelectorAll('.spike-month li').length >= 4`, 12_000)
  await sleep(500)
  check('a receipt with a very long subject does not push the spike off the screen', await formFits(), (await book.texts('.spike-what strong')).join(' | ').slice(0, 80))
  await shot(book, 'phone-spike')
  await closeForm()
  await openFromMenu('מנויים')
  await book.waitFor(`document.querySelectorAll('.subs-card').length >= 5`, 20_000)
  await book.waitFor(`!document.querySelector('.subs-ledger').textContent.includes('עוד קוראים')`, 30_000)
  await sleep(400)
  check('subscriptions fit the phone, however long a plan', await formFits())
  await shot(book, 'phone-subscriptions')
  await closeForm()
  await openFromMenu('מגירת הקבצים')
  await book.waitFor(`document.querySelectorAll('.drawer-file').length >= 4`, 12_000)
  const widths = await book.evaluate<number[]>(`(() => {
    const list = document.querySelector('.drawer-files').getBoundingClientRect()
    const first = document.querySelector('.drawer-file').getBoundingClientRect()
    return [Math.round(first.width), Math.round(list.width)]
  })()`)
  check('in the files drawer a slip is as wide as the drawer', (await formFits()) && widths[0]! >= widths[1]! - 2, widths.join(' of '))
  await shot(book, 'phone-files')
  await closeForm()
  await openFromMenu('אלבום הבולים')
  await book.waitFor('.album-search')
  const field = await book.evaluate<string>(`(() => {
    const style = getComputedStyle(document.querySelector('.album-search'))
    const [r, g, b] = style.backgroundColor.match(/[0-9.]+/g).map(Number)
    return style.colorScheme + ' ' + (r > 200 && g > 200 && b > 180 ? 'pale' : 'dark ' + style.backgroundColor)
  })()`)
  check('the album\u2019s search line is a pale line on the form, at night too', field === 'light pale' && (await formFits()), field)
  await shot(book, 'phone-album')
  await closeForm()

  // A receipt from abroad that is a web page pasted into an email. Its total is in kronur and
  // stands only in the HTML (the plain-text part has the price before fees); the page is wider
  // than any letter, at any scale; and one of its pictures can no longer be fetched.
  await openFromMenu('דוקרן הקבלות')
  await book.waitFor(`[...document.querySelectorAll('.spike-amount')].some((cell) => cell.textContent.includes('884'))`, 15_000)
  const kronur = (await book.texts('.spike-amount')).find((sum) => sum.includes('884')) ?? ''
  check('a sum in another currency is read from the letter itself, fees included', kronur.includes('884 kr'), kronur)
  // The newest month's own rows, added up here per currency, against what its header says.
  // (Which receipts fall in it depends on the day the check runs, so the sums are not fixed.)
  const month = await book.evaluate<{ header: string; rows: Record<string, number> }>(`(() => {
    const section = document.querySelector('.spike-month')
    const rows = {}
    for (const cell of section.querySelectorAll('.spike-amount')) {
      const text = cell.textContent.replace(/[⁦⁩]/g, '')
      const value = Number(text.replace(/[^0-9.]/g, ''))
      const currency = text.includes('₪') ? '₪' : text.includes('$') ? '$' : text.includes('kr') ? 'kr' : text.includes('€') ? '€' : '?'
      if (value) rows[currency] = Math.round(((rows[currency] ?? 0) + value) * 100) / 100
    }
    return { header: section.querySelector('.spike-sum').textContent.replace(/[⁦⁩]/g, ''), rows }
  })()`)
  const headed = (currency: string, value: number) =>
    month.header.includes(currency === '₪' ? `${value.toLocaleString('en-US', { minimumFractionDigits: 2 })} ₪` : currency === 'kr' ? `${value} kr` : `${currency}${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  check(
    'a month adds up each currency by itself',
    Object.keys(month.rows).length >= 2 && Object.entries(month.rows).every(([currency, value]) => headed(currency, value)),
    `${month.header} / ${JSON.stringify(month.rows)}`,
  )
  await book.clickText('P2 - Receipt', '.spike-month li button')
  await book.waitFor('.letter iframe')
  await book.waitFor(`document.querySelector('.letter iframe').contentDocument?.documentElement.classList.contains('doar-tight')`, 10_000)
  await sleep(1200)
  const pasted = await book.evaluate<{ room: number; wide: number; right: number; sideways: string; logo: number; gone: string }>(`(() => {
    const frame = document.querySelector('.letter iframe')
    const page = frame.contentDocument
    const zoom = Number(page.body.style.zoom || 1)
    const total = [...page.querySelectorAll('td')].find((cell) => cell.textContent.trim() === '884 kr').getBoundingClientRect()
    return {
      room: frame.clientWidth,
      wide: page.documentElement.scrollWidth,
      right: Math.round(total.right),
      sideways: page.documentElement.style.overflowX,
      logo: Math.round(page.querySelector('img[height="30"]').getBoundingClientRect().height / zoom),
      gone: getComputedStyle(page.querySelector('img.logoimg')).display,
    }
  })()`)
  check('a web page pasted into an email fits the letter, to its last column', pasted.wide <= pasted.room + 2 && pasted.right <= pasted.room && pasted.sideways === '', JSON.stringify(pasted))
  check('a picture keeps the height its email asked for', pasted.logo === 30, String(pasted.logo))
  check('a picture that cannot be fetched leaves no mark', pasted.gone === 'none', pasted.gone)
  const paper = await book.text('.kind-card[data-kind="receipt"]')
  check('the card on the receipt shows the total', paper.includes('884 kr'), paper)
  await shot(book, 'phone-pasted-page')

  check('nothing went wrong in the guide', book.errors.length === 0, book.errors.join(' | ').slice(0, 300))
  book.close()

  // On a PC the guide's rows stand in two columns, and a row can open "לאן?".
  const wide = await browser.open(`${SITE}/?demo=fast&guide`, PC)
  await wide.waitFor('.guide-book', 25_000)
  await sleep(500)
  check('"?guide" in the address opens the guide at once', (await wide.count('.guide-row')) >= 25)
  check('on a PC its rows stand in two columns', (await wide.evaluate<number>(`getComputedStyle(document.querySelector('.guide-rows')).gridTemplateColumns.split(' ').length`)) === 2)
  await shot(wide, 'pc-guide')
  await wide.click('[aria-controls="guide-more-palette"]')
  await wide.waitFor('#guide-more-palette .guide-try')
  await wide.click('#guide-more-palette .guide-try')
  await wide.waitFor('.palette')
  check('from the guide, "לאן?" opens on the desk', (await wide.count('.guide-book')) === 0)
  await wide.type('מדריך')
  await sleep(250)
  await wide.key('Enter')
  await wide.waitFor('.guide-book')
  check('and "לאן?" finds the guide', true)
  await wide.key('Escape')
  await wide.waitFor(`!document.querySelector('.guide-book')`)
  check('nothing went wrong in the guide on a PC', wide.errors.length === 0, wide.errors.join(' | ').slice(0, 300))
  wide.close()

  // ================= The home-screen widget, from an Android phone =================
  const droid = await browser.open(`${SITE}/?demo=fast`, PHONE)
  await droid.waitFor('.thread-row', 25_000)
  await droid.evaluate(`localStorage.setItem('doar:settings:demo', JSON.stringify({ tipsDone: ['demo', 'guide', 'install', 'push'] }))`)
  await droid.cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  })
  // What the widget opens when it is not connected yet.
  await droid.goto(`${SITE}/?demo=fast&widget`)
  await droid.waitFor('#widget-settings', 25_000)
  await sleep(400)
  check(
    'the widget link opens Settings at the widget',
    await droid.evaluate<boolean>(`(() => { const r = document.getElementById('widget-settings').getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight / 2 })()`),
  )
  await droid.clickText('חיבור הווידג׳ט', '.pill-btn')
  await droid.waitFor('.widget-list li', 6000)
  check('connecting lists the widget under the phone', (await droid.text('.widget-list li')).includes('טלפון'), await droid.text('.widget-list li'))
  await shot(droid, 'phone-widget')
  await droid.clickText('ניתוק', '.widget-list .pill-btn')
  await droid.waitFor(`!document.querySelector('.widget-list li')`, 6000)
  check('disconnecting takes it off the list', true)
  const apk = await droid.evaluate<number>(`fetch('/doar-widget.apk', { method: 'HEAD' }).then((r) => (r.ok ? Number(r.headers.get('content-length') ?? 1) : 0))`)
  check('the widget app is there to download', apk > 0, String(apk))
  check('nothing went wrong while connecting the widget', droid.errors.length === 0, droid.errors.join(' | ').slice(0, 300))
  droid.close()

  // ================= The front door =================
  const door = await browser.open(SITE, PHONE)
  await door.waitFor('.google-btn', 25_000)
  check('without the demo, the sign-in screen opens', (await door.text('.google-btn')).includes('Google'))
  check('it offers the demo', (await door.count('a[href="/?demo"]')) === 1)
  await door.click('.guide-link')
  await door.waitFor('.guide-book')
  check('the guide is open to those who have not signed in', (await door.count('.guide-row')) >= 25)
  await door.click('[aria-controls="guide-more-album"]')
  await door.waitFor('#guide-more-album')
  check('there its rows explain, and offer nothing to press', (await door.count('.guide-try')) === 0)
  check('and it ends with the way to the demo', (await door.count('.guide-end a[href="/?demo"]')) === 1)
  await door.click('.guide-head .icon-btn')
  await door.waitFor(`!document.querySelector('.guide-book')`)
  check('nothing went wrong at the front door', door.errors.length === 0, door.errors.join(' | ').slice(0, 300))
} finally {
  await browser.close()
}

if (failed) process.exit(1)
console.log('all screens are in order')
