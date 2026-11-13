// One-time codes ("your verification code is 482913"), found in a letter's subject and
// first words. Pure functions, shared by the Edge Function and the app, and checked by
// scripts/check-postman.ts.

/** Words that say a number nearby is a code to type in somewhere. */
const KEYWORDS = [
  /קוד\s+ה?(?:אימות|כניסה|גישה|אבטחה|התחברות|זיהוי|אישור|זמני)/g,
  /קוד\s+חד[\s־-]?פעמי/g,
  /סיסמ[הא]\s+(?:חד[\s־-]?פעמית|זמנית)/g,
  /הקוד\s+שלך/g,
  /(?:verification|security|login|log-in|sign-?in|authentication|confirmation|access|one-?time|single-use)\s+code/gi,
  /one-?time\s+(?:password|passcode|pin)/gi,
  /\botp\b/gi,
  /\bpasscode\b/gi,
  /\byour\s+code\b/gi,
  /\buse\s+code\b/gi,
]

/** Four to eight digits, possibly written "482 913" or "4829-1345", standing on their own. */
const DIGITS = /(?<![\d.,/:#₪$€]|\d[-\s])(\d{3}[\s-]\d{3}|\d{4}[\s-]\d{4}|\d{4,8})(?![\d/:]|[.,]\d|[-\s]\d|\s?(?:₪|ש"ח|ש״ח|nis\b|usd\b|\$|€|%))/gi

/** Just before a number, these words mean it is something else: an order, a card's last digits, a phone. */
const NOT_A_CODE = /(?:הזמנה|חשבונית|קבלה|אסמכתא|טלפון|המסתיי[םמ]ת?\s+ב|order|invoice|receipt|reference|ending\s+in|ends\s+with|last\s+(?:4|four)|call|tel)[\s:#.־-]*$/i

const isYear = (digits: string) => digits.length === 4 && Number(digits) >= 1990 && Number(digits) <= 2099

function near(text: string): string | null {
  const marks: { start: number; end: number }[] = []
  for (const keyword of KEYWORDS) {
    keyword.lastIndex = 0
    for (let hit = keyword.exec(text); hit; hit = keyword.exec(text)) marks.push({ start: hit.index, end: hit.index + hit[0].length })
  }
  if (marks.length === 0) return null

  let best: { code: string; distance: number } | null = null
  DIGITS.lastIndex = 0
  for (let hit = DIGITS.exec(text); hit; hit = DIGITS.exec(text)) {
    const code = hit[1]!.replace(/\D/g, '')
    if (isYear(code) || NOT_A_CODE.test(text.slice(Math.max(0, hit.index - 24), hit.index))) continue
    const end = hit.index + hit[0].length
    for (const mark of marks) {
      // A code usually follows its words ("the code is 482913"); sometimes it leads ("482913 is your code").
      const distance = hit.index >= mark.end ? hit.index - mark.end : mark.start >= end ? (mark.start - end) * 2 : 0
      if (distance <= 90 && (!best || distance < best.distance)) best = { code, distance }
    }
  }
  return best?.code ?? null
}

/** The one-time code in a letter, as digits only, or null when there is none. */
export function findCode(subject: string, text: string): string | null {
  return near(subject) ?? near(`${subject}\n${text.slice(0, 400)}`)
}

/** A code the way people read it out: "482 913", "4829 1345". */
export function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  return code
}
