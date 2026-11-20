// Checks what can happen to a note (src/lib/notes.ts): writing, throwing away and
// bringing back, the order on the desk, and reading back what was saved.
//
//   node --experimental-strip-types scripts/check-notes.ts

import { arranged, countLabel, dayLabel, discard, MAX_LENGTH, read, restore, save, tidy, tilt, whenLabel, write, type Note } from '../src/lib/notes.ts'

let failed = false
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`)
  if (!ok) failed = true
}

// ---------- Writing ----------

let notes: Note[] = []
notes = write(notes, 'a', 'לקנות חלב', 1000)
check('the first words on a fresh slip make it a note', notes, [{ id: 'a', text: 'לקנות חלב', createdAt: 1000, updatedAt: 1000 }])
check('a fresh slip with only spaces on it is not a note', write(notes, 'b', '  \n ', 2000), notes)
notes = write(notes, 'b', 'להתקשר לדנה', 2000)
notes = write(notes, 'a', 'לקנות חלב ולחם', 3000)
check('writing on a note keeps when it was first written', notes.find((note) => note.id === 'a'), { id: 'a', text: 'לקנות חלב ולחם', createdAt: 1000, updatedAt: 3000 })
check('writing the same words again changes nothing', write(notes, 'a', 'לקנות חלב ולחם', 9000) === notes, true)
check('a note is no longer than a slip holds', write([], 'long', 'א'.repeat(MAX_LENGTH + 50), 1)[0]!.text.length, MAX_LENGTH)

// ---------- The order on the desk ----------

check('the note written on last lies first', arranged(notes).map((note) => note.id), ['a', 'b'])
check('arranging leaves the notes themselves as they were', notes.map((note) => note.id), ['a', 'b'])

// ---------- Throwing away, and back ----------

const thrown = notes.find((note) => note.id === 'b')!
const fewer = discard(notes, 'b')
check('a thrown note is gone', fewer.map((note) => note.id), ['a'])
check('brought back, it lies where it lay', arranged(restore(fewer, thrown)).map((note) => note.id), ['a', 'b'])
check('bringing back a note that is there does not double it', restore(notes, thrown).length, 2)

const emptied = write(notes, 'b', '   ', 4000)
check('a note can be wiped clean while it is in hand', emptied.find((note) => note.id === 'b')!.text, '   ')
check('put back with nothing on it, it is not kept', tidy(emptied).map((note) => note.id), ['a'])
check('tidying a desk with no empty slips changes nothing', tidy(notes) === notes, true)

// ---------- Saved and read back ----------

check('what is saved reads back the same', read(save(notes)), notes)
check('nothing saved yet is an empty desk', read(null), [])
check('a broken save is an empty desk, not a crash', read('{"notes": [oops'), [])
check(
  'only notes are read back: no id, no text and doubles are left out',
  read(JSON.stringify({ version: 1, notes: [{ id: 'x', text: 'כן', createdAt: 5, updatedAt: 6 }, { text: 'no id' }, { id: 'y' }, null, { id: 'x', text: 'double' }, { id: 'z', text: 'בלי זמן' }] })),
  [
    { id: 'x', text: 'כן', createdAt: 5, updatedAt: 6 },
    { id: 'z', text: 'בלי זמן', createdAt: 0, updatedAt: 0 },
  ],
)

// ---------- Small words ----------

check('one note, and several', [countLabel(1), countLabel(2), countLabel(11)], ['פתק אחד', '2 פתקים', '11 פתקים'])
const now = new Date(2026, 10, 20, 10, 5).getTime()
check('today, yesterday, a date, and a date of another year', [
  dayLabel(new Date(2026, 10, 20, 0, 1).getTime(), now),
  dayLabel(new Date(2026, 10, 19, 23, 59).getTime(), now),
  dayLabel(new Date(2026, 10, 12, 8, 0).getTime(), now),
  dayLabel(new Date(2025, 11, 31, 8, 0).getTime(), now),
], ['היום', 'אתמול', '12.11', '31.12.25'])
check('with the hour, for the note in hand', whenLabel(new Date(2026, 10, 20, 9, 7).getTime(), now), 'היום 09:07')
check('a slip tilts the same way every time, and only a little', [tilt('a') === tilt('a'), Math.abs(tilt('some-long-id-123')) <= 1.6, tilt('a') !== tilt('b')], [true, true, true])

if (failed) process.exit(1)
