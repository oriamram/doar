import type { Message } from '../types'
import { shortName } from './addresses'
import { formatLetterDate } from './format'
import { escapeHtml } from './gmail'
import { stripTrackers } from './inspector'

/**
 * Print one letter, cleanly: who, to whom, when, and the letter itself, with none of
 * the app around it. The letter is laid out in a hidden frame that may not run
 * scripts, so nothing inside an email runs on its way to the printer.
 */
export function printLetter(message: Message, subject: string) {
  const people = (list: Message['to']) => list.map((contact) => escapeHtml(contact.name ? `${contact.name} <${contact.email}>` : contact.email)).join(', ')
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;inset-inline-end:0;inset-block-end:0;width:0;height:0;border:0'
  frame.srcdoc = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title>
<style>
  body { margin: 24px; font: 14px/1.6 system-ui, sans-serif; color: #000; }
  header { margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #999; }
  h1 { margin: 0 0 8px; font-size: 19px; }
  .meta { font-size: 12.5px; color: #333; }
  img { max-width: 100%; height: auto; }
</style></head><body>
<header>
  <h1 dir="auto">${escapeHtml(subject)}</h1>
  <div class="meta">מאת: ${people([message.from])}</div>
  ${message.to.length ? `<div class="meta">אל: ${people(message.to)}</div>` : ''}
  ${message.cc.length ? `<div class="meta">העתק: ${people(message.cc)}</div>` : ''}
  <div class="meta">${escapeHtml(formatLetterDate(message.date))}</div>
</header>
<div dir="auto">${stripTrackers(message.bodyHtml).html}</div>
</body></html>`
  frame.addEventListener('load', () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    // The frame has done its job once the print window closes; a minute is plenty.
    setTimeout(() => frame.remove(), 60_000)
  })
  document.body.append(frame)
  return shortName(message.from)
}
