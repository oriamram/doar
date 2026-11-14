// A hidden Edge (or Chrome) that the check scripts drive through the DevTools protocol:
// open a page at a phone's or a PC's size, click, type, press keys, read the page, take pictures.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Event = { method: string; params: any }

/** A tiny Chrome DevTools Protocol client over Node's built-in WebSocket. */
export function connect(url: string) {
  const socket = new WebSocket(url)
  let nextId = 1
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const events: Event[] = []
  const listeners = new Set<(event: Event) => void>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)!
      waiting.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    } else if (message.method) {
      events.push(message)
      listeners.forEach((listener) => listener(message))
    }
  })
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)))
  })
  const send = async (method: string, params: object = {}): Promise<any> => {
    await ready
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
  }
  return { send, events, on: (listener: (event: Event) => void) => listeners.add(listener), close: () => socket.close() }
}

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((path): path is string => !!path)

export type Screen = { width: number; height: number; dark?: boolean; touch?: boolean }

export const PHONE: Screen = { width: 390, height: 844, touch: true }
export const PC: Screen = { width: 1280, height: 800 }

const KEYS: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Tab: { code: 'Tab', keyCode: 9 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
}

export type Page = Awaited<ReturnType<Awaited<ReturnType<typeof launch>>['open']>>

/** Start a hidden browser. Remember to `close()` it. */
export async function launch(port = 9391) {
  const path = BROWSERS.find((candidate) => existsSync(candidate))
  if (!path) throw new Error('No Edge or Chrome was found (set BROWSER_PATH)')
  // A browser left over from an earlier run would answer on the same port, with its old state.
  if (await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false)) {
    throw new Error(`something already listens on port ${port}; close it and run again`)
  }
  // A run that was stopped could not clean up after itself: its profile is still in the
  // temp folder. An hour on, no run can still be using it.
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('doar-check-')) continue
    try {
      const old = join(tmpdir(), name)
      if (Date.now() - statSync(old).mtimeMs > 3_600_000) rmSync(old, { recursive: true, force: true })
    } catch {
      // Not ours to insist on; the next run tries again.
    }
  }
  const profile = mkdtempSync(join(tmpdir(), 'doar-check-'))
  const child: ChildProcess = spawn(
    path,
    // A browser that belongs to nobody. Left alone, Edge signs a new profile in with the
    // Windows account and starts syncing that person's browser into it: their extensions
    // arrive some minutes in, one of them opens a welcome tab, and a picture taken of a tab
    // that lost the front never returns. So: no sign-in, no sync, no extensions.
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-features=msImplicitSignin',
      '--disable-sync',
      '--disable-extensions',
      '--hide-scrollbars',
      '--mute-audio',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let version: { webSocketDebuggerUrl: string } | null = null
  for (let i = 0; i < 60 && !version; i++) {
    await sleep(250)
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json() as Promise<{ webSocketDebuggerUrl: string }>, () => null)
  }
  if (!version) throw new Error('the browser did not start')
  const browser = connect(version.webSocketDebuggerUrl)

  /** Open a page at a given screen size. */
  async function open(url: string, screen: Screen = PC) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as { id: string; webSocketDebuggerUrl: string }[]
    const cdp = connect(targets.find((target) => target.id === targetId)!.webSocketDebuggerUrl)
    const errors: string[] = []
    cdp.on((event) => {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text ?? 'exception')
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
        errors.push(event.params.args.map((arg: { value?: unknown; description?: string }) => String(arg.value ?? arg.description ?? '')).join(' '))
      }
    })
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')

    const resize = async (next: Screen) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: next.width, height: next.height, deviceScaleFactor: 1, mobile: !!next.touch })
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!next.touch })
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: next.dark ? 'dark' : 'light' }] })
    }
    await resize(screen)
    await cdp.send('Page.navigate', { url })

    const evaluate = async <T = any>(expression: string): Promise<T> => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value as T
    }

    /** Wait until a JavaScript expression is truthy in the page (a selector counts when it matches something). */
    const waitFor = async (what: string, timeout = 8000) => {
      const expression = /^[.#[a-z]/i.test(what) && !/[()=]/.test(what.replace(/\[[^\]]*\]|:[a-z-]+\([^)]*\)/g, '')) ? `!!document.querySelector(${JSON.stringify(what)})` : what
      const end = Date.now() + timeout
      while (Date.now() < end) {
        if (await evaluate(expression).catch(() => false)) return
        await sleep(80)
      }
      throw new Error(`timed out waiting for: ${what}`)
    }

    /** The middle of the first element matching the selector (or the n-th), scrolled into view and standing still. */
    const center = async (selector: string, index = 0) => {
      const point = await evaluate<{ x: number; y: number } | null>(`(async () => {
        const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}]
        if (!element) return null
        element.scrollIntoView({ block: 'center', inline: 'center' })
        // Something sliding into place (a note, a form) is pressed where it lands, not where it started.
        let box = element.getBoundingClientRect()
        for (let i = 0; i < 40; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          const next = element.getBoundingClientRect()
          const still = Math.abs(next.left - box.left) < 0.5 && Math.abs(next.top - box.top) < 0.5
          box = next
          if (still) break
        }
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      })()`)
      if (!point) throw new Error(`nothing matches ${selector}${index ? ` [${index}]` : ''}`)
      return point
    }

    const mouse = (type: string, x: number, y: number, extra: object = {}) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
    const touch = (type: string, x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })

    /** A real click (or a tap, on a touch screen) in the middle of an element. */
    const click = async (selector: string, index = 0) => {
      await waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length > ${index}`)
      const { x, y } = await center(selector, index)
      if (screen.touch) {
        await touch('touchStart', x, y)
        await touch('touchEnd', x, y)
      } else {
        await mouse('mouseMoved', x, y, { button: 'none' })
        await mouse('mousePressed', x, y)
        await mouse('mouseReleased', x, y)
      }
      await sleep(60)
    }

    /** Click the first element whose text contains `text` (buttons, links, menu items). */
    const clickText = async (text: string, within = 'button, a, [role="menuitem"], [role="tab"], label, summary') => {
      const index = await evaluate<number>(`[...document.querySelectorAll(${JSON.stringify(within)})].findIndex((el) => el.offsetParent !== null && (el.textContent || '').includes(${JSON.stringify(text)}))`)
      if (index < 0) throw new Error(`no visible element says "${text}"`)
      await click(within, index)
    }

    /** Hold a finger on an element (touch screens). */
    const hold = async (selector: string, ms = 650, index = 0) => {
      const { x, y } = await center(selector, index)
      await touch('touchStart', x, y)
      await sleep(ms)
      await touch('touchEnd', x, y)
      await sleep(80)
    }

    /** Drag from an element by (dx, dy): a swipe on a touch screen, a mouse drag otherwise. */
    const drag = async (selector: string, dx: number, dy: number, index = 0, steps = 12) => {
      const { x, y } = await center(selector, index)
      if (screen.touch) await touch('touchStart', x, y)
      else {
        await mouse('mouseMoved', x, y, { button: 'none' })
        await mouse('mousePressed', x, y)
      }
      for (let step = 1; step <= steps; step++) {
        const nx = x + (dx * step) / steps
        const ny = y + (dy * step) / steps
        if (screen.touch) await touch('touchMove', nx, ny)
        else await mouse('mouseMoved', nx, ny)
        await sleep(16)
      }
      if (screen.touch) await touch('touchEnd', x + dx, y + dy)
      else await mouse('mouseReleased', x + dx, y + dy)
      await sleep(120)
    }

    /** Type into whatever has the focus (click the box first). */
    const type = async (text: string) => {
      await cdp.send('Input.insertText', { text })
      await sleep(40)
    }

    /** Press a key: a named one ("Enter", "Escape") or a character; "Control+k" for a chord. */
    const key = async (name: string) => {
      const parts = name.split('+')
      const main = parts.pop()!
      const modifiers = (parts.includes('Alt') ? 1 : 0) | (parts.includes('Control') ? 2 : 0) | (parts.includes('Meta') ? 4 : 0) | (parts.includes('Shift') ? 8 : 0)
      const named = KEYS[main]
      const base = named
        ? { key: main, code: named.code, windowsVirtualKeyCode: named.keyCode, ...(main === 'Enter' ? { text: String.fromCharCode(13) } : {}) }
        : { key: main, code: /^[a-z]$/i.test(main) ? `Key${main.toUpperCase()}` : '', windowsVirtualKeyCode: main.toUpperCase().charCodeAt(0), ...(modifiers & ~8 ? {} : { text: main }) }
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...base })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...base })
      await sleep(60)
    }

    /** Save a picture of what's on screen. */
    const shot = async (file: string) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(data, 'base64'))
    }

    return {
      cdp,
      errors,
      evaluate,
      waitFor,
      click,
      clickText,
      hold,
      drag,
      type,
      key,
      shot,
      resize: async (next: Screen) => {
        screen = next
        await resize(next)
      },
      goto: (next: string) => cdp.send('Page.navigate', { url: next }),
      text: (selector: string) => evaluate<string>(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`),
      count: (selector: string) => evaluate<number>(`document.querySelectorAll(${JSON.stringify(selector)}).length`),
      texts: (selector: string) => evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => (el.textContent ?? '').trim())`),
      close: () => cdp.close(),
    }
  }

  async function close() {
    // Ask the browser to quit by itself; it runs as several processes, and this closes them all.
    await browser.send('Browser.close').catch(() => {})
    browser.close()
    await sleep(600)
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill()
    await sleep(300)
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      // The browser may still hold a file for a moment; the folder is in the system's temp directory.
    }
  }

  return { open, close, send: browser.send }
}
