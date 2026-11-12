import { parseAddressList } from './addresses'
import { filesToAttachments, newDraft } from './compose'
import { escapeHtml, textToHtml } from './gmail'
import type { ComposeDraft } from '../types'

/**
 * Why Doar was opened, when it wasn't just the icon: a tapped notification, a
 * "mailto:" link on the PC, the icon's "new letter" shortcut, or something shared
 * from another app on the phone.
 */
export type LaunchIntent =
  | { kind: 'thread'; id: string }
  | { kind: 'compose'; draft: ComposeDraft }
  | { kind: 'share' }
  | { kind: 'scheduled' }

const SHARE_CACHE = 'doar-share'

/** A letter from a "mailto:" link: mailto:dana@example.com?subject=Hi&body=… */
export function draftFromMailto(link: string): ComposeDraft {
  const rest = link.replace(/^mailto:/i, '')
  const cut = rest.indexOf('?')
  const addresses = cut < 0 ? rest : rest.slice(0, cut)
  // In mailto links a plus sign is a plus sign, not a space.
  const params = new URLSearchParams(cut < 0 ? '' : rest.slice(cut + 1).replace(/\+/g, '%2B'))
  const decode = (text: string) => {
    try {
      return decodeURIComponent(text)
    } catch {
      return text
    }
  }
  const draft = newDraft(parseAddressList([decode(addresses), params.get('to') ?? ''].filter(Boolean).join(', ')))
  draft.cc = parseAddressList(params.get('cc') ?? '')
  draft.bcc = parseAddressList(params.get('bcc') ?? '')
  draft.subject = params.get('subject') ?? ''
  const body = params.get('body')
  if (body) draft.html = textToHtml(body) + draft.html
  return draft
}

export function readIntent(address: string): LaunchIntent | null {
  let params: URLSearchParams
  try {
    params = new URL(address, window.location.origin).searchParams
  } catch {
    return null
  }
  const thread = params.get('thread')
  if (thread) return { kind: 'thread', id: thread }
  if (params.get('view') === 'scheduled') return { kind: 'scheduled' }
  if (params.has('share')) return { kind: 'share' }
  const mailto = params.get('mailto')
  if (mailto) return { kind: 'compose', draft: draftFromMailto(mailto) }
  if (params.has('compose')) return { kind: 'compose', draft: newDraft() }
  return null
}

/**
 * What another app shared into Doar, as a new letter. The service worker caught the
 * share and put it aside (public/sw-extra.js); this picks it up, once.
 */
export async function takeShared(): Promise<ComposeDraft | null> {
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    const stored = await cache.match('/__share/meta')
    if (!stored) return null
    const meta = (await stored.json()) as { title: string; text: string; url: string; files: { name: string; type: string; key: string }[] }
    const files: File[] = []
    for (const item of meta.files) {
      const blob = await (await cache.match(item.key))?.blob()
      if (blob) files.push(new File([blob], item.name, { type: item.type }))
    }
    await caches.delete(SHARE_CACHE)

    const draft = newDraft()
    draft.subject = meta.title
    const lines = [meta.text, meta.url].filter(Boolean)
    if (lines.length) draft.html = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('') + draft.html
    draft.attachments = filesToAttachments(files)
    return draft
  } catch {
    return null
  }
}

type LaunchQueue = { setConsumer: (consumer: (params: { targetURL?: string }) => void) => void }

/**
 * Listen for every way Doar can be asked to open something. Returns a function that stops listening.
 * `onMail` is called when the service worker says new mail has arrived.
 */
export function onLaunch(handle: (intent: LaunchIntent) => void, onMail: () => void): () => void {
  let last = ''
  let lastAt = 0
  const take = (address: string) => {
    // The same launch can be reported twice (by the page's address and by the launch queue).
    if (address === last && Date.now() - lastAt < 3000) return
    const intent = readIntent(address)
    if (!intent) return
    last = address
    lastAt = Date.now()
    handle(intent)
  }

  // Opened with something in the address: act on it, then tidy the address bar.
  if (window.location.search) {
    take(window.location.href)
    window.history.replaceState(window.history.state, '', window.location.pathname)
  }

  // Already open, and a notification was tapped (or mail arrived).
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null
    if (data?.type === 'doar-open' && data.url) take(data.url)
    if (data?.type === 'doar-new-mail') onMail()
  }
  navigator.serviceWorker?.addEventListener('message', onMessage)

  // Already open as an installed app, and launched again (a mail link, the icon's shortcut).
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer((params) => {
    if (params.targetURL) take(params.targetURL)
  })

  return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
}
