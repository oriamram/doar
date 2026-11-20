// The inspector: what can be said about a letter's sender, its links and its hidden
// marks before trusting it. It reads what Gmail already sent (the verdict Gmail itself
// reached about the sender, the name, the address, the links, the pictures) and it
// stamps: it never hides a letter and never deletes one. Pure functions, checked by
// scripts/check-inspector.ts.

import { KNOWN_SENDERS, type KnownSender } from './known-senders.ts'

// ---------- Sites ----------

/** Second-level names that countries put before their own ending ("co.il", "org.uk"). */
const COUNTRY_SECOND = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'muni', 'k12', 'idf', 'mil', 'ne', 'or', 'go'])

/** The site an address belongs to: "mail.leumi.co.il" → "leumi.co.il", "news.shop.com" → "shop.com". */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  const country = labels.at(-1)!.length === 2 && COUNTRY_SECOND.has(labels.at(-2)!)
  return labels.slice(country ? -3 : -2).join('.')
}

/** The site's own name, without its ending: "bank-dugma.example" → "bank-dugma". */
const nameOfSite = (site: string) => site.split('.')[0] ?? ''

const under = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

// ---------- Gmail's verdict about the sender ----------

export type Auth = { dmarc: 'pass' | 'fail' | null; domain: string }

/**
 * Gmail writes what it concluded in an "Authentication-Results" header that starts with
 * its own name. Only that one is read: a header like it further down could have been
 * written by the sender.
 */
export function readAuth(headers: readonly string[]): Auth {
  const own = headers.find((value) => /^\s*mx\.google\.com\s*;/i.test(value))
  if (!own) return { dmarc: null, domain: '' }
  const result = /\bdmarc=([a-z]+)/i.exec(own)?.[1]?.toLowerCase()
  const domain = /\bheader\.from=([^\s;]+)/i.exec(own)?.[1]?.toLowerCase() ?? ''
  return { dmarc: result === 'pass' ? 'pass' : result === 'fail' ? 'fail' : null, domain }
}

// ---------- Names and look-alikes ----------

/** A name as it is compared: lower case, no quotes or marks, single spaces. */
const plainName = (name: string) =>
  name
    .toLowerCase()
    .replace(/["'`״׳“”‘’<>()[\]|®™©]/g, ' ')
    .replace(/[^\p{L}\p{N}@.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A short listed name ("max", "ביט") counts only as the whole name; a longer one also inside a longer name. */
function carries(name: string, listed: string, distinct = false): boolean {
  if (name === listed) return true
  // An ordinary word ("partner", "max") is a body's name only when it stands alone.
  const long = listed.includes(' ') || (distinct && listed.length >= 6)
  return long && new RegExp(`(?<![\\p{L}\\p{N}])${listed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(name)
}

/** Letters and digits that pass for one another in an address: paypa1, rnicrosoft, g00gle. */
const lookalike = (text: string) => text.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1i|]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's')

/** One letter added, dropped, changed, or two swapped. */
function oneOff(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const restA = a.slice(i)
  const restB = b.slice(i)
  if (a.length === b.length) return restA.slice(1) === restB.slice(1) || (restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2))
  return a.length > b.length ? restA.slice(1) === restB : restB.slice(1) === restA
}

const MIXED = /[a-z]/i
const OTHER_ALPHABET = /[Ͱ-ϿЀ-ӿ]/

// ---------- The sender ----------

export type Finding = {
  /** Intact: Gmail verified the sender and nothing looks off. Broken: something serious does. Null: nothing to say. */
  seal: 'intact' | 'broken' | null
  /** Serious signs, worded for the reader. */
  warnings: string[]
  /** Softer signs: worth a second look, often innocent. */
  cautions: string[]
  /** The site Gmail verified the letter came from (for the intact seal). */
  verified: string
}

export type SenderFacts = {
  name: string
  email: string
  /** Every "Authentication-Results" header on the letter, in order. */
  auth: readonly string[]
  /** It came through a mailing list, which often breaks the check without anyone lying. */
  list?: boolean
  /** The reader said they know this sender: soft signs are put away. */
  trusted?: boolean
}

export function inspectSender(facts: SenderFacts, known: readonly KnownSender[] = KNOWN_SENDERS): Finding {
  const warnings: string[] = []
  const cautions: string[] = []
  const email = facts.email.toLowerCase()
  const host = email.split('@')[1] ?? ''
  const site = siteOf(host)
  const label = nameOfSite(site)
  const name = plainName(facts.name)
  const auth = readAuth(facts.auth)

  if (auth.dmarc === 'fail' && !facts.list) {
    warnings.push(`Gmail לא הצליח לאמת שהמכתב באמת נשלח מ־${host || 'הכתובת הזאת'}. ייתכן שמישהו מתחזה לשולח.`)
  }

  // The name shows one address and the letter comes from another.
  const shown = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/.exec(facts.name)
  if (shown && siteOf(shown[1]!.toLowerCase()) !== site) {
    warnings.push(`בשם השולח כתובה הכתובת ${shown[0]}, אבל המכתב נשלח מ־${email}.`)
  }

  // An address written in two alphabets, made to look like another.
  if (MIXED.test(host) && OTHER_ALPHABET.test(host)) {
    warnings.push(`בכתובת ${host} מעורבות אותיות מכמה כתבים, כך שהיא נראית כמו כתובת אחרת.`)
  } else if (host.split('.').some((part) => part.startsWith('xn--'))) {
    cautions.push(`הכתובת ${host} כתובה באותיות שאינן לטיניות, ועלולה להיראות כמו כתובת אחרת.`)
  }

  const theirs = (body: KnownSender) => body.domains.some((domain) => under(host, domain))
  const display = (body: KnownSender) => body.names[0]!

  // A near-copy of a well-known site: paypa1.com, leurni.co.il, gooogle.com.
  const copied = known.find(
    (body) =>
      body.distinct &&
      !theirs(body) &&
      body.domains.some((domain) => {
        const real = nameOfSite(domain)
        return real.length >= 5 && label !== real && (lookalike(label) === lookalike(real) || oneOff(label, real))
      }),
  )
  if (copied) warnings.push(`הכתובת ${host} דומה מאוד לכתובת של ${display(copied)}, אבל אינה שלהם.`)

  if (!copied) {
    // A well-known name on an address that is not theirs.
    const named = name ? known.find((body) => !theirs(body) && body.names.some((listed) => carries(name, listed, body.distinct))) : undefined
    // A well-known site's name inside another address: paypal-secure.com, paypal.com.login.net.
    const inside = known.find(
      (body) =>
        body.distinct &&
        !theirs(body) &&
        body.domains.some((domain) => {
          const real = nameOfSite(domain)
          return real.length >= 5 && host.split(/[.-]/).join(' ').includes(real.split('-').join(' ')) && label !== real
        }),
    )
    if (named) cautions.push(`השם אומר „${facts.name.trim()}”, אבל הכתובת ${host} אינה אחת הכתובות המוכרות של ${display(named)}.`)
    else if (inside) cautions.push(`הכתובת ${host} מכילה את השם של ${display(inside)}, אבל אינה שלהם.`)
  }

  const soft = facts.trusted ? [] : cautions
  return {
    seal: warnings.length ? 'broken' : soft.length ? null : auth.dmarc === 'pass' ? 'intact' : null,
    warnings,
    cautions: soft,
    verified: auth.dmarc === 'pass' ? auth.domain || site : '',
  }
}

// ---------- Links ----------

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 'buff.ly', 'did.li', 'tiny.cc', 'shorturl.at', 't.ly', 'rebrand.ly', 'lnkd.in', 'bit.do', 's.id'])

/**
 * Mail systems often wrap every link in one of their own, which passes the reader on
 * to the real address (Outlook's "safe links", Google's and Facebook's redirects,
 * Proofpoint). Where the link leads is what counts, so the wrapping is taken off.
 */
function unwrap(url: URL): URL {
  const host = url.hostname.toLowerCase()
  let inner: string | null = null
  if (host.endsWith('.safelinks.protection.outlook.com')) inner = url.searchParams.get('url')
  else if ((host === 'www.google.com' || host === 'google.com') && url.pathname === '/url') inner = url.searchParams.get('q') ?? url.searchParams.get('url')
  else if (host === 'l.facebook.com' || host === 'lm.facebook.com' || host === 'l.instagram.com') inner = url.searchParams.get('u')
  else if (host === 'urldefense.com') inner = /\/v3\/__(.+?)__;/.exec(url.pathname + url.search)?.[1] ?? null
  else if (host === 'urldefense.proofpoint.com') inner = url.searchParams.get('u')?.replace(/-3A/g, ':').replace(/_/g, '/').replace(/-2D/g, '-').replace(/-2E/g, '.') ?? null
  if (!inner) return url
  try {
    const target = new URL(inner)
    return target.protocol === 'http:' || target.protocol === 'https:' ? target : url
  } catch {
    return url
  }
}

export type LinkRisk = {
  why: 'other-site' | 'number' | 'short'
  /** Where the link really leads. */
  target: string
  /** The site the link's text names, when it names one. */
  shown?: string
}

/**
 * Should the reader be told where a link leads before it opens? Yes when its text
 * names one site and it leads to another, when it leads to a bare number instead of a
 * name, and, in a letter that already looks off (`flagged`), when it hides its target
 * behind a link shortener. In mail from a list, a text that names another site is the
 * usual click counting, so it is left alone unless the letter is flagged.
 */
export function linkRisk(text: string, href: string, options: { flagged?: boolean; list?: boolean } = {}): LinkRisk | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url = unwrap(url)
  const host = url.hostname.toLowerCase()
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return { why: 'number', target: host }

  const words = text.trim().replace(/‎|‏/g, '')
  const named = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/?#:]\S*)?$/i.exec(words)?.[1]?.toLowerCase()
  if (named && siteOf(named) !== siteOf(host) && (options.flagged || !options.list)) return { why: 'other-site', target: host, shown: named }

  if (options.flagged && SHORTENERS.has(siteOf(host))) return { why: 'short', target: host }
  return null
}

// ---------- Tracking marks ----------

const TRACKER_HOST = /^(?:track(?:ing)?|trk|open|opens|pixel|px|beacon|email-?open|o)\d*\./i
const TRACKER_PATH =
  /\/(?:open|o|pixel|px|beacon|track|trk|t)\.(?:gif|png|jpg)\b|\/track\/open|\/wf\/open|\/e2t\/o\/|\/trk\/|\/open\/?\?|\/emailopen|\/email_open|\/o\/[\w-]{16,}|\/pixel\/|\/beacon\/|open\.php|[?&](?:open|track(?:ing)?_?id|email_id)=/i
const TRACKER_SITES = /(?:^|\.)(?:list-manage\.com|mailtrack\.io|emltrk\.com|mltrk\.io|awstrack\.me|getnotify\.com|yesware\.com|mixmax\.com|bananatag\.com|mailfoogae\.appspot\.com|superhuman\.com|sendibt\d*\.com|mandrillapp\.com|pstmrk\.it|hubspotemail\.net|sidekickopen\d*\.com|doubleclick\.net|google-analytics\.com)$/i

const OPEN_MARK = /\/(?:open|o|pixel|px|beacon|track|trk|t)(?:\.(?:gif|png|jpg))?$/i

const tiny = (value: string | null | undefined) => value != null && /^\s*[01](?:px)?\s*$/i.test(value)

/** Is this picture there to report that the letter was opened, rather than to be seen? */
export function isTracker(image: { src: string; width?: string | null; height?: string | null; style?: string | null }): boolean {
  if (!/^https?:/i.test(image.src.trim())) return false
  const style = (image.style ?? '').toLowerCase().replace(/\s+/g, '')
  // Too small to see, or told not to show: a picture nobody is meant to look at.
  if (tiny(image.width) && tiny(image.height)) return true
  if (/display:none|visibility:hidden|opacity:0(?![.\d])/.test(style)) return true
  if (/(?:^|;)width:[01](?:px)?(?:;|$)/.test(style) && /(?:^|;)height:[01](?:px)?(?:;|$)/.test(style)) return true
  try {
    const url = new URL(image.src.trim())
    const host = url.hostname.toLowerCase()
    const where = url.pathname + url.search
    // A service known for it, a host that says what it is ("track.shop.com/open.gif"), or a one-pixel side with such a path.
    return (
      (TRACKER_SITES.test(host) && TRACKER_PATH.test(where)) ||
      (TRACKER_HOST.test(host) && OPEN_MARK.test(url.pathname)) ||
      ((tiny(image.width) || tiny(image.height)) && TRACKER_PATH.test(where))
    )
  } catch {
    return false
  }
}

const ATTRIBUTE = /\b(src|width|height|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

/**
 * Take out the pictures that are only there to report that the letter was opened,
 * before the browser can fetch them. The letter's own text is cut, not re-written, so
 * everything else in it stays exactly as it was sent.
 */
export function stripTrackers(html: string): { html: string; removed: number } {
  let removed = 0
  const cleaned = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const found: Record<string, string> = {}
    ATTRIBUTE.lastIndex = 0
    for (let hit = ATTRIBUTE.exec(tag); hit; hit = ATTRIBUTE.exec(tag)) found[hit[1]!.toLowerCase()] ??= (hit[2] ?? hit[3] ?? hit[4] ?? '').replace(/&amp;/g, '&')
    if (!found.src || !isTracker({ src: found.src, width: found.width, height: found.height, style: found.style })) return tag
    removed++
    return ''
  })
  return { html: cleaned, removed }
}

export const countMarks = (count: number) => (count === 1 ? 'הוסר סימן מעקב אחד' : `הוסרו ${count} סימני מעקב`)
