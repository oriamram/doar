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
