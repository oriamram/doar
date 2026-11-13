// Checks the automatic-label rules (supabase/functions/postman/rules.ts).
//
//   node --experimental-strip-types scripts/check-rules.ts

import { labelsFor, matches, normalizeMatch, senderAddress, type Rule } from '../supabase/functions/postman/rules.ts'

let failed = false
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`)
  if (!ok) failed = true
}

// What people type.
check('a full address stays an address', normalizeMatch('  Dana@Example.com '), 'dana@example.com')
check('a name with an address gives the address', normalizeMatch('Dana Cohen <dana@example.com>'), 'dana@example.com')
check('a site name becomes a domain', normalizeMatch('bank.co.il'), '@bank.co.il')
check('"@site" becomes a domain', normalizeMatch('@Bank.co.il'), '@bank.co.il')
check('a web address becomes a domain', normalizeMatch('https://www.bank.co.il/login?x=1'), '@bank.co.il')
check('a word alone is refused', normalizeMatch('bank'), null)
check('nothing is refused', normalizeMatch('   '), null)
check('two addresses are refused', normalizeMatch('a@b.com, c@d.com'), null)

// Who a letter is from.
check('the address inside a From header', senderAddress('"Bank, The" <Alerts@Mail.Bank.co.il>'), 'alerts@mail.bank.co.il')
check('a bare address', senderAddress('  dana@example.com '), 'dana@example.com')
check('an address in the name does not fool it', senderAddress('"boss@evil.com" <dana@example.com>'), 'dana@example.com')

// Which letters a rule covers.
check('an address rule covers that address', matches('dana@example.com', 'dana@example.com'), true)
check('an address rule covers nobody else', matches('dana@example.com', 'dan@example.com'), false)
check('a domain rule covers the domain', matches('@bank.co.il', 'alerts@bank.co.il'), true)
check('a domain rule covers its subdomains', matches('@bank.co.il', 'alerts@mail.bank.co.il'), true)
check('a domain rule is not fooled by a longer name', matches('@bank.co.il', 'alerts@notbank.co.il'), false)
check('a domain rule is not fooled by a suffix', matches('@bank.co.il', 'alerts@bank.co.il.evil.com'), false)

const rules: Rule[] = [
  { id: '1', match: '@bank.co.il', label_id: 'Label_1' },
  { id: '2', match: 'alerts@mail.bank.co.il', label_id: 'Label_2' },
  { id: '3', match: '@mail.bank.co.il', label_id: 'Label_1' },
  { id: '4', match: 'dana@example.com', label_id: 'Label_3' },
]
check('every rule that fits adds its label, each label once', labelsFor(rules, 'The Bank <alerts@mail.bank.co.il>'), ['Label_1', 'Label_2'])
check('a stranger gets no label', labelsFor(rules, 'Someone <someone@else.org>'), [])

if (failed) process.exit(1)
