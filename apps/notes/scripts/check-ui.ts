// Walks the notes app with a hidden browser, a real pointer and a real keyboard, on a
// phone's screen and on a PC's, and checks what each step leaves on screen. The notes it
// writes live in that browser only.
//
//   npm run build && npm run preview -- --port 4174 --strictPort      (in one terminal)
//   npm run check:ui                                                   (in another)
//
// SITE=http://localhost:5174 checks the dev server instead. SHOTS=some/folder saves pictures.

import { launch, PC, PHONE, sleep, type Page } from '../../../tools/browser.ts'

const SITE = process.env.SITE ?? 'http://localhost:4174'
const SHOTS = process.env.SHOTS

let failed = false
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.shot(`${SHOTS}/${name}.png`)
}

const slips = (page: Page) => page.texts('.slips .slip-text')
const inHand = (page: Page) => page.count('.in-hand')
/** Nothing is wider than the screen: no sideways scrolling. */
const fits = (page: Page) => page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')
/** Tear a note off the pad, write on it, and put it back. */
async function writeNote(page: Page, text: string) {
  await page.click('.pad')
  await page.waitFor('.slip-paper')
  await page.type(text)
  await page.clickText('סיום', '.slip-actions button')
  await page.waitFor(`!document.querySelector('.in-hand')`)
}
const saved = (page: Page) => page.evaluate<{ text: string }[]>(`JSON.parse(localStorage.getItem('pitkiyot:notes') ?? '{"notes":[]}').notes`)

const browser = await launch()
try {
  // ================= A phone =================
  const phone = await browser.open(SITE, PHONE)
  await phone.waitFor('.pad', 25_000)
  await phone.evaluate('localStorage.clear()')
  await phone.goto(SITE)
  await sleep(400)
  await phone.waitFor('.pad', 25_000)

  check('an empty desk says how to start', (await phone.text('.empty')).includes('פתק חדש') && (await phone.count('.slips .slip')) === 0)
  check('it says where the notes are kept', (await phone.text('.where')).includes('במכשיר הזה בלבד'))
  const padBox = await phone.evaluate<{ bottom: number; left: number; position: string }>(
    `(() => { const pad = document.querySelector('.pad'); const box = pad.getBoundingClientRect(); return { bottom: innerHeight - box.bottom, left: box.left, position: getComputedStyle(pad).position } })()`,
  )
  check('on a phone the pad waits at the bottom, under the thumb', padBox.position === 'fixed' && padBox.bottom > 0 && padBox.bottom < 60 && padBox.left < 40, JSON.stringify(padBox))
  await shot(phone, 'phone-empty')

  // A new note.
  await phone.click('.pad')
  await phone.waitFor('.slip-paper')
  check('pressing the pad puts a fresh note in hand, ready to write on', await phone.evaluate<boolean>(`document.activeElement === document.querySelector('.slip-paper')`))
  check('a fresh note has no bin yet', (await phone.count('.slip-throw')) === 0)
  await phone.type('לקנות חלב')
  await shot(phone, 'phone-writing')
  check('every letter is saved as it is written', (await saved(phone))[0]?.text === 'לקנות חלב', JSON.stringify(await saved(phone)))
  await phone.clickText('סיום', '.slip-actions button')
  await phone.waitFor(`!document.querySelector('.in-hand')`)
  check('put back, the note lies on the desk', (await slips(phone)).join('|') === 'לקנות חלב' && (await phone.text('.top-count')) === 'פתק אחד', (await slips(phone)).join('|'))
  check('and says it was written today', (await phone.text('.slip-day')) === 'היום')

  // An empty slip is not kept.
  await phone.click('.pad')
  await phone.waitFor('.slip-paper')
  await phone.clickText('סיום', '.slip-actions button')
  await phone.waitFor(`!document.querySelector('.in-hand')`)
  check('a note put back with nothing on it is not kept', (await slips(phone)).length === 1 && (await saved(phone)).length === 1)

  // A second note lies first; writing on the older one brings it to the front.
  await writeNote(phone, 'להתקשר לדנה')
  check('the newest note lies first', (await slips(phone)).join('|') === 'להתקשר לדנה|לקנות חלב', (await slips(phone)).join('|'))
  await phone.click('.slips .slip', 1)
  await phone.waitFor('.slip-paper')
  check('a note taken in hand shows what is on it, with the pen at its end', await phone.evaluate<boolean>(`(() => { const paper = document.querySelector('.slip-paper'); return paper.value === 'לקנות חלב' && paper.selectionStart === paper.value.length })()`))
  await phone.type(' ולחם')
  await phone.clickText('סיום', '.slip-actions button')
  await phone.waitFor(`!document.querySelector('.in-hand')`)
  check('a note written on again comes to the front', (await slips(phone)).join('|') === 'לקנות חלב ולחם|להתקשר לדנה', (await slips(phone)).join('|'))

  // The phone's Back puts the note back; it does not leave the app.
  await phone.click('.slips .slip', 0)
  await phone.waitFor('.in-hand')
  await phone.evaluate('history.back()')
  await phone.waitFor(`!document.querySelector('.in-hand')`)
  check("the phone's Back puts the note back and stays in the app", (await phone.count('.slips .slip')) === 2 && (await phone.evaluate<string>('location.href')).startsWith(SITE))

  // Closing the app and opening it again.
  await phone.goto(SITE)
  await sleep(400)
  await phone.waitFor('.slips .slip', 25_000)
  check('the notes are there when the app is opened again', (await slips(phone)).join('|') === 'לקנות חלב ולחם|להתקשר לדנה', (await slips(phone)).join('|'))

  // Throwing a note away, and bringing it back.
  await phone.click('.slips .slip', 1)
  await phone.waitFor('.slip-throw')
  await phone.click('.slip-throw')
  await phone.waitFor('.receipt')
  check('a thrown note leaves the desk, and a receipt offers to bring it back', (await slips(phone)).join('|') === 'לקנות חלב ולחם' && (await phone.text('.receipt-text')) === 'הפתק נזרק.' && (await inHand(phone)) === 0)
  await shot(phone, 'phone-thrown')
  await phone.click('.receipt-action')
  await phone.waitFor(`document.querySelectorAll('.slips .slip').length === 2`)
  check('"ביטול" brings it back to where it lay', (await slips(phone)).join('|') === 'לקנות חלב ולחם|להתקשר לדנה' && (await phone.count('.receipt')) === 0, (await slips(phone)).join('|'))
  await phone.click('.slips .slip', 1)
  await phone.waitFor('.slip-throw')
  await phone.click('.slip-throw')
  await phone.waitFor('.receipt')
  await phone.waitFor(`!document.querySelector('.receipt')`, 9000)
  check('left alone, the receipt goes and the note stays thrown', (await slips(phone)).join('|') === 'לקנות חלב ולחם' && (await saved(phone)).length === 1)

  // Long words and long notes stay inside their slip and inside the screen.
  await writeNote(phone, 'https://example.com/a-very-long-address/that-has-no-spaces-in-it-at-all/and-goes-on-and-on-and-on/until-it-is-far-wider-than-any-phone')
  await writeNote(phone, Array.from({ length: 30 }, (_, line) => `שורה ${line + 1} של פתק ארוך`).join('\n'))
  check('a long address and a long note do not push the page sideways', await fits(phone))
  const inside = await phone.evaluate<boolean>(`[...document.querySelectorAll('.slips .slip')].every((slip) => { const box = slip.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && Math.abs(box.width - box.height) < 2 })`)
  check('every slip stays a square inside the screen', inside)
  await shot(phone, 'phone-desk')
  await phone.click('.slips .slip', 0)
  await phone.waitFor('.slip-paper')
  await sleep(300)
  const hand = await phone.evaluate<{ fits: boolean; done: boolean }>(
    `(() => { const slip = document.querySelector('.slip-open').getBoundingClientRect(); const done = document.querySelector('.slip-done').getBoundingClientRect(); return { fits: slip.left >= 0 && slip.right <= innerWidth, done: done.bottom <= innerHeight && done.height >= 40 } })()`,
  )
  check('a long note in hand fits the screen, with "סיום" in reach', hand.fits && hand.done, JSON.stringify(hand))
  await shot(phone, 'phone-in-hand')
  await phone.key('Escape')
  await phone.waitFor(`!document.querySelector('.in-hand')`)

  check('nothing went wrong on the phone', phone.errors.length === 0, phone.errors.join(' | ').slice(0, 300))

  // ================= The same notes in another window =================
  const other = await browser.open(SITE, PHONE)
  await other.waitFor('.slips .slip', 25_000)
  await writeNote(other, 'נכתב בחלון אחר')
  await phone.waitFor(`[...document.querySelectorAll('.slips .slip-text')].some((slip) => slip.textContent === 'נכתב בחלון אחר')`, 6000)
  check('a note written in another window shows in this one', true)
  other.close()
  phone.close()

  // ================= At night =================
  const night = await browser.open(SITE, { ...PHONE, dark: true })
  await night.waitFor('.slips .slip', 25_000)
  const colors = await night.evaluate<{ theme: string; desk: string; ink: string }>(
    `(() => ({ theme: document.documentElement.dataset.theme, desk: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.querySelector('.slip')).color }))()`,
  )
  check('at night the desk is dark and a note is still dark ink on light paper', colors.theme === 'dark' && colors.desk === 'rgb(19, 25, 34)' && colors.ink === 'rgb(51, 48, 31)', JSON.stringify(colors))
  await shot(night, 'phone-night')
  night.close()

  // ================= A PC =================
  const pc = await browser.open(SITE, PC)
  await pc.waitFor('.slips .slip', 25_000)
  const first = await pc.evaluate<{ pad: boolean; position: string }>(
    `(() => ({ pad: document.querySelector('.slips > li').classList.contains('pad-cell'), position: getComputedStyle(document.querySelector('.pad')).position }))()`,
  )
  check('on a PC the pad lies first among the slips', first.pad && first.position !== 'fixed', JSON.stringify(first))
  const count = (await slips(pc)).length
  await pc.key('n')
  await pc.waitFor('.slip-paper')
  check('"n" tears a new note off the pad', await pc.evaluate<boolean>(`document.activeElement === document.querySelector('.slip-paper')`))
  await pc.type('נכתב במחשב')
  await pc.key('Escape')
  await pc.waitFor(`!document.querySelector('.in-hand')`)
  check('Esc puts it back, kept', (await slips(pc))[0] === 'נכתב במחשב' && (await slips(pc)).length === count + 1, (await slips(pc))[0])
  check('and the keyboard is back on the note that was in hand', await pc.evaluate<boolean>(`document.activeElement === document.querySelector('.slips .slip')`))
  await pc.key('Enter')
  await pc.waitFor('.slip-paper')
  check('Enter takes the note under the keyboard in hand', (await pc.evaluate<string>(`document.querySelector('.slip-paper').value`)) === 'נכתב במחשב')
  await pc.type(' ועוד מילה')
  await pc.key('Control+Enter')
  await pc.waitFor(`!document.querySelector('.in-hand')`)
  check('Ctrl+Enter puts it back too', (await slips(pc))[0] === 'נכתב במחשב ועוד מילה', (await slips(pc))[0])
  await pc.click('.slips .slip', 0)
  await pc.waitFor('.in-hand')
  await sleep(350)
  await shot(pc, 'pc-in-hand')
  // A press on the dimmed desk, away from the note.
  await pc.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: 700, button: 'left', clickCount: 1 })
  await pc.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 60, y: 700, button: 'left', clickCount: 1 })
  await pc.waitFor(`!document.querySelector('.in-hand')`)
  check('a press on the dimmed desk puts the note back', (await slips(pc)).length === count + 1)
  await sleep(250)
  await shot(pc, 'pc-desk')

  // The app itself: its name, its icon, and the worker that keeps it on the device.
  const manifest = await pc.evaluate<{ name: string; icons: unknown[] } | null>(`(async () => { const link = document.querySelector('link[rel="manifest"]'); return link ? (await fetch(link.href)).json() : null })()`)
  check('it is an app of its own, by the name פתקיות', manifest?.name === 'פתקיות' && (manifest?.icons.length ?? 0) >= 3, JSON.stringify(manifest)?.slice(0, 80))
  if (!SITE.includes(':5174')) {
    await pc.waitFor(`navigator.serviceWorker.getRegistration().then((registration) => !!registration?.active)`, 15_000)
    check('its worker is in place, so it opens with no connection', true)
  }
  check('nothing went wrong on the PC', pc.errors.length === 0, pc.errors.join(' | ').slice(0, 300))
  await pc.evaluate('localStorage.clear()')
  pc.close()
} finally {
  await browser.close()
}

console.log(failed ? 'something is not in order' : 'all screens are in order')
if (failed) process.exit(1)
