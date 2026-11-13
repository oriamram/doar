// Walks Doar's main screens in the demo mailbox ("?demo"), with a hidden browser, a real
// pointer and a real keyboard, and checks what each step leaves on screen. Nothing here
// touches a real mailbox or Doar's server.
//
//   npm run build && npm run preview -- --port 4173 --strictPort      (in one terminal)
//   node --experimental-strip-types scripts/check-ui.ts               (in another)
//
// SITE=http://localhost:5173 checks the dev server instead. SHOTS=some/folder saves pictures.

import { launch, PC, PHONE, sleep, type Page } from './lib/browser.ts'

const SITE = process.env.SITE ?? 'http://localhost:4173'
const SHOTS = process.env.SHOTS

let failed = false
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

/** The demo with its one-time note put away and no wait before sending, so steps don't depend on timing. */
async function start(page: Page, settings: Record<string, unknown> = {}) {
  await page.waitFor('.thread-row', 25_000)
  await page.evaluate(`localStorage.setItem('doar:settings:demo', ${JSON.stringify(JSON.stringify({ tipsDone: ['demo'], undoSendSeconds: 0, ...settings }))})`)
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
  check('one press copies it', (await toast(desk)) === 'הקוד הועתק' && (await desk.evaluate<string>('window.__copied')) === '482913', `${await toast(desk)}: ${await desk.evaluate<string>('window.__copied')}`)
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
  await desk.key('Escape')

  const strays = await desk.evaluate<{ place: string; message: string }[]>('window.__doarDemo.reports')
  check('no fault was reported along the way', strays.length === 0, strays.map((report) => `${report.place}: ${report.message}`).join(' | ').slice(0, 400))
  check('nothing went wrong at the desk', desk.errors.length === 0, desk.errors.join(' | ').slice(0, 300))
  desk.close()

  // ================= Opening the mail, one letter at a time (a phone, from a fresh start) =================
  const rite = await browser.open(`${SITE}/?demo=fast`, PHONE)
  await start(rite)
  await rite.waitFor('.postman-strip')
  await sleep(600)
  check('with unread mail, the postman offers to open it one by one', (await rite.text('.postman-strip')).includes('הדוור הביא 8 מכתבים'), await rite.text('.postman-strip'))
  await shot(rite, 'phone-postman')
  await rite.click('.postman-strip')
  await rite.waitFor('.ritual .letter iframe')
  const riteSubject = () => rite.text('.ritual .thread-subject')
  const riteLeft = () => rite.text('.ritual-count')
  const ticket = (name: string) => rite.clickText(name, '.ritual-tickets .ticket')
  const nextLetter = async (after: string) => rite.waitFor(`(document.querySelector('.ritual .thread-subject')?.textContent ?? '') !== ${JSON.stringify(after)} || !!document.querySelector('.ritual-bundle, .clear-desk')`)
  check('the first letter is from a person, and already open', (await riteSubject()) === 'אישור פגישה ביום שלישי' && (await riteLeft()).includes('8'), `${await riteSubject()} · ${await riteLeft()}`)
  check('a letter in the ritual has no bar of its own', (await rite.evaluate<string>(`getComputedStyle(document.querySelector('.ritual .reader-bar')).display`)) === 'none')
  await shot(rite, 'phone-ritual')

  let shown = await riteSubject()
  await ticket('לתיוק')
  await nextLetter(shown)
  check('filing a letter brings the next one', (await riteLeft()).includes('7') && (await riteSubject()) !== shown, `${await riteSubject()} · ${await riteLeft()}`)

  shown = await riteSubject()
  const kept = shown
  await ticket('להשאיר')
  await nextLetter(shown)
  check('"keep" moves on and leaves the letter in the inbox', (await riteLeft()).includes('6'), await riteLeft())

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

  // The rest: file the letters, then each bundle as one decision, until the desk is clear.
  let sawBundle = false
  for (let step = 0; step < 20 && !(await rite.count('.clear-desk')); step++) {
    if (await rite.count('.ritual-bundle')) {
      if (!sawBundle) await shot(rite, 'phone-ritual-bundle')
      sawBundle = true
      await ticket('לתייק הכל')
    } else await ticket('לתיוק')
    await sleep(350)
  }
  check('a bundle is one decision', sawBundle)
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

  // ================= The front door =================
  const door = await browser.open(SITE, PHONE)
  await door.waitFor('.google-btn', 25_000)
  check('without the demo, the sign-in screen opens', (await door.text('.google-btn')).includes('Google'))
  check('it offers the demo', (await door.count('a[href="/?demo"]')) === 1)
  check('nothing went wrong at the front door', door.errors.length === 0, door.errors.join(' | ').slice(0, 300))
} finally {
  await browser.close()
}

if (failed) process.exit(1)
console.log('all screens are in order')
