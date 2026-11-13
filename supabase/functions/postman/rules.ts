// Automatic labels: mail from a certain sender gets a certain label.
// Pure functions, used by the Edge Function and checked by scripts/check-rules.ts.

/** A rule as the database keeps it: mail from `match` gets the Gmail label `label_id`. */
export type Rule = { id: string; match: string; label_id: string }

/** The address inside a From header: "Dana Cohen <Dana@Example.com>" gives "dana@example.com". */
export function senderAddress(from: string): string {
  const inside = from.match(/<([^<>]+)>\s*$/)
  return (inside ? inside[1]! : from).trim().toLowerCase()
}

/**
 * Tidy what a person typed into a rule. A full address stays an address
 * ("dana@example.com"); anything that names a site becomes that whole domain
 * ("@example.com", from "example.com", "@example.com" or "https://www.example.com/page").
 * Null when it is neither.
 */
export function normalizeMatch(input: string): string | null {
  let text = input.trim().toLowerCase()
  const inside = text.match(/<([^<>]+)>/)
  if (inside) text = inside[1]!.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return text
  text = text
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^@/, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]!
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) ? `@${text}` : null
}

/** Does mail from this address fall under the rule? A domain rule also covers its subdomains. */
export function matches(match: string, address: string): boolean {
  if (!match.startsWith('@')) return address === match
  const domain = address.slice(address.lastIndexOf('@') + 1)
  const wanted = match.slice(1)
  return domain === wanted || domain.endsWith(`.${wanted}`)
}

/** The labels a letter should get, given who it is from. */
export function labelsFor(rules: Rule[], from: string): string[] {
  const address = senderAddress(from)
  return [...new Set(rules.filter((rule) => matches(rule.match, address)).map((rule) => rule.label_id))]
}
