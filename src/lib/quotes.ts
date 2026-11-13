/**
 * Earlier letters quoted under a reply. In a long conversation every reply carries
 * all the letters before it, so the same text comes round again and again; Doar
 * folds it behind a small tab ("···") that opens it on request.
 *
 * Quotes are found by the marks mail programs leave on them. A letter that is
 * nothing but its quote (a forwarded letter) is left open.
 */

/** What Gmail, Apple Mail, Thunderbird, Yahoo and Outlook put around or before the quoted letter. */
const MARKS = '.gmail_quote, .gmail_extra, blockquote[type="cite"], .yahoo_quoted, .moz-cite-prefix, #divRplyFwdMsg, #appendonsend, .OutlookMessageHeader'

/** Marks that only open a quote: everything after them, to the end of the letter, belongs to it. */
const OPENERS = '#divRplyFwdMsg, #appendonsend, .OutlookMessageHeader'

const FORWARDED = /forwarded message|begin forwarded|הודעה שהועברה|הודעה מועברת/i

const letters = (text: string | null) => (text ?? '').replace(/\s+/g, '').length

/** The elements that make up the quoted letter, or none when there is nothing to fold. */
export function quotedParts(body: HTMLElement): HTMLElement[] {
  const first = [...body.querySelectorAll<HTMLElement>(MARKS)].find((element) => !element.parentElement?.closest(MARKS))
  if (!first || FORWARDED.test((first.textContent ?? '').slice(0, 400))) return []
  const parts = [first]
  // (The letter lives in a frame of its own, so these are checked by shape, not by `instanceof`.)
  if (first.matches(OPENERS)) {
    const rule = first.previousElementSibling
    if (rule?.tagName === 'HR') parts.unshift(rule as HTMLElement)
    for (let next = first.nextElementSibling; next; next = next.nextElementSibling) parts.push(next as HTMLElement)
  } else if (first.matches('.moz-cite-prefix') && first.nextElementSibling) {
    parts.push(first.nextElementSibling as HTMLElement)
  }
  const quoted = parts.reduce((sum, part) => sum + letters(part.textContent), 0)
  return letters(body.textContent) - quoted > 0 ? parts : []
}

/** Fold the quoted letter away behind a tab. `refit` is called whenever the letter's height changes. */
export function foldQuotes(body: HTMLElement, refit: () => void) {
  const parts = quotedParts(body)
  if (parts.length === 0) return
  const shown = parts.map((part) => part.style.display)
  const tab = body.ownerDocument.createElement('button')
  tab.type = 'button'
  tab.className = 'doar-quote-tab'
  tab.textContent = '···'
  let open = false
  const apply = () => {
    parts.forEach((part, index) => {
      part.style.display = open ? shown[index]! : 'none'
    })
    const label = open ? 'הסתרת המכתב הקודם' : 'הצגת המכתב הקודם'
    tab.title = label
    tab.setAttribute('aria-label', label)
    tab.setAttribute('aria-expanded', String(open))
    refit()
  }
  tab.addEventListener('click', () => {
    open = !open
    apply()
  })
  parts[0]!.before(tab)
  apply()
}
