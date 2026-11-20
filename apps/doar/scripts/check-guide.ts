// The guide's promise is that it is light to read: every thing in one short line, in
// everyday words, with a picture. This check keeps the promise as the guide grows.
//
//   node --experimental-strip-types scripts/check-guide.ts

import { readFileSync } from 'node:fs'
import { GUIDE, GUIDE_LEAD, GUIDE_LIMITS, GUIDE_TITLE, TRY_LABELS } from '../src/lib/guide.ts'

let failed = false
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failed = true
}

const entries = GUIDE.flatMap((chapter) => chapter.entries)
const small = GUIDE.flatMap((chapter) => chapter.small)
const names = [...entries, ...small].map((item) => item.name)
const repeated = <T>(items: T[]) => items.filter((item, index) => items.indexOf(item) !== index)

check('there is a guide', GUIDE.length >= 5 && entries.length >= 20 && GUIDE_TITLE.length > 0 && GUIDE_LEAD.length <= 48, `${GUIDE.length} chapters, ${entries.length} rows, ${small.length} small ones`)
check('no chapter is long', GUIDE.every((chapter) => chapter.entries.length <= 6 && chapter.small.length <= 6), GUIDE.map((chapter) => `${chapter.tab}: ${chapter.entries.length}+${chapter.small.length}`).join(', '))
check('every chapter has a short tag and a title', GUIDE.every((chapter) => chapter.tab.length > 0 && chapter.tab.length <= 16 && chapter.title.length > 0))
check('no chapter appears twice', repeated(GUIDE.map((chapter) => chapter.id)).length === 0 && repeated(GUIDE.map((chapter) => chapter.tab)).length === 0)
check('no thing appears twice', repeated(entries.map((entry) => entry.id)).length === 0 && repeated(names).length === 0, repeated(names).join(', '))

// The pictures are drawn in GuideArt.tsx, one per row, under the row's id.
const drawn = [...readFileSync(new URL('../src/components/GuideArt.tsx', import.meta.url), 'utf8').matchAll(/^ {2}(\w+): \(\) => \(/gm)].map((hit) => hit[1]!)
const ids = entries.map((entry) => entry.id)
check('every row has its picture', ids.every((id) => drawn.includes(id)), ids.filter((id) => !drawn.includes(id)).join(', '))
check('no picture is left without a row', drawn.every((id) => ids.includes(id)), drawn.filter((id) => !ids.includes(id)).join(', '))

// Short lines.
const long = (text: string, limit: number) => text.length > limit
const tooLong = [
  ...entries.filter((entry) => long(entry.name, GUIDE_LIMITS.name)).map((entry) => `${entry.name} (name)`),
  ...entries.filter((entry) => long(entry.plain, GUIDE_LIMITS.plain)).map((entry) => `${entry.name} (plain, ${entry.plain.length})`),
  ...entries.filter((entry) => long(entry.how, GUIDE_LIMITS.how)).map((entry) => `${entry.name} (how, ${entry.how.length})`),
  ...entries.filter((entry) => long(entry.why, GUIDE_LIMITS.why)).map((entry) => `${entry.name} (why, ${entry.why.length})`),
  ...small.filter((item) => long(item.name, GUIDE_LIMITS.name) || long(item.plain, GUIDE_LIMITS.small)).map((item) => `${item.name} (small, ${item.plain.length})`),
]
check('every line is short', tooLong.length === 0, tooLong.join(', '))

// Whole sentences.
const lines = [...entries.flatMap((entry) => [entry.plain, entry.how, entry.why]), ...small.map((item) => item.plain)]
const unfinished = lines.filter((line) => !/[.?!]$/.test(line.trim()))
check('every line is a finished sentence', unfinished.length === 0, unfinished.join(' | ').slice(0, 200))
check('nothing is left empty', lines.every((line) => line.trim().length >= 8) && names.every((name) => name.trim().length >= 2))

// Everyday words: the only foreign words are names of things the reader already meets.
const KNOWN = new Set(['Gmail', 'Google', 'Chrome', 'Edge', 'Ctrl', 'K', 'Enter', 'MB', 'R', 'e', 'r', 'c'])
const foreign = [...new Set([...lines, ...names].flatMap((line) => line.match(/[A-Za-z]+/g) ?? []))].filter((word) => !KNOWN.has(word))
check('the words are everyday words', foreign.length === 0, foreign.join(', '))

// No dashes for pauses, and Hebrew quotation marks around what the app says.
const marks = [...lines, ...names].filter((line) => /[—–]| - |"/.test(line))
check('the punctuation is the app’s own', marks.length === 0, marks.join(' | ').slice(0, 200))

// A row's button says where it goes.
const places = entries.map((entry) => entry.try).filter((place) => place !== undefined)
check('every button has its words', places.every((place) => (TRY_LABELS[place] ?? '').length > 0) && Object.keys(TRY_LABELS).every((place) => places.includes(place as (typeof places)[number])), Object.keys(TRY_LABELS).filter((place) => !places.includes(place as (typeof places)[number])).join(', '))

if (failed) process.exit(1)
console.log(`the guide is in order: ${entries.length} rows and ${small.length} small ones, in ${GUIDE.length} chapters`)
