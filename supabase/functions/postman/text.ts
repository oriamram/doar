// Mail headers and Gmail's preview text, turned into plain words for notifications and
// the home-screen widget. Pure functions, checked by scripts/check-postman.ts.

/** Turn "=?UTF-8?B?…?=" in a mail header back into text. */
export function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_match, charset: string, kind: string, text: string) => {
    try {
      let bytes: Uint8Array
      if (kind.toLowerCase() === 'b') {
        bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
      } else {
        const out: number[] = []
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '_') out.push(32)
          else if (text[i] === '=' && i + 2 < text.length) {
            out.push(parseInt(text.slice(i + 1, i + 3), 16))
            i += 2
          } else out.push(text.charCodeAt(i))
        }
        bytes = new Uint8Array(out)
      }
      return new TextDecoder(charset).decode(bytes)
    } catch {
      return text
    }
  })
}

/** The name in a From header, or the address's first part when there is no name. */
export function senderName(from: string): string {
  const decoded = decodeWords(from).trim()
  const match = decoded.match(/^"?([^"<]*)"?\s*<([^>]+)>/)
  const name = match?.[1]?.trim()
  if (name) return name
  const email = (match?.[2] ?? decoded).trim()
  return email.split('@')[0] || email
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Gmail's preview text comes with HTML entities. */
export function plain(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/g, (match, name: string) => ENTITIES[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
