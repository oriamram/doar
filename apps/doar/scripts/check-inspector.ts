// Checks the inspector (src/lib/inspector.ts): Gmail's verdict about a sender, names
// and addresses that imitate well-known bodies, links that lead elsewhere than they
// say, and pictures that only report that a letter was opened.
//
//   node --experimental-strip-types scripts/check-inspector.ts

import { countMarks, inspectSender, isTracker, linkRisk, readAuth, siteOf } from '../src/lib/inspector.ts'
import { DEMO_KNOWN, KNOWN_SENDERS } from '../src/lib/known-senders.ts'

let failed = false
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`)
  if (!ok) failed = true
}

const pass = (domain: string) => [`mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=x@${domain}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}`]
const fail = (domain: string) => [`mx.google.com; dkim=none; spf=softfail smtp.mailfrom=x@${domain}; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=${domain}`]
const known = [...KNOWN_SENDERS, ...DEMO_KNOWN]
const sender = (name: string, email: string, auth: string[] = pass(email.split('@')[1]!), more: { list?: boolean; trusted?: boolean } = {}) => inspectSender({ name, email, auth, ...more }, known)
const seal = (...args: Parameters<typeof sender>) => sender(...args).seal
const counts = (...args: Parameters<typeof sender>) => {
  const found = sender(...args)
  return [found.seal, found.warnings.length, found.cautions.length]
}

// ---------- Sites ----------

check('a site under a country ending', siteOf('mail.leumi.co.il'), 'leumi.co.il')
check('a site under .com', siteOf('news.shop.example.com'), 'example.com')
check('a bare site', siteOf('gmail.com'), 'gmail.com')
check('a government site', siteOf('www.btl.gov.il'), 'btl.gov.il')

// ---------- Gmail's verdict ----------

check('a passing verdict', readAuth(pass('dana.example')), { dmarc: 'pass', domain: 'dana.example' })
check('a failing verdict', readAuth(fail('bank.example')).dmarc, 'fail')
check('no verdict about DMARC', readAuth(['mx.google.com; spf=pass smtp.mailfrom=a@b.example']).dmarc, null)
check('"bestguesspass" is not a pass', readAuth(['mx.google.com; dmarc=bestguesspass header.from=b.example']).dmarc, null)
check("a verdict the sender wrote is ignored", readAuth(['evil.example; dmarc=pass header.from=bank.example']).dmarc, null)
check("Gmail's own verdict is found among others", readAuth(['evil.example; dmarc=pass', ...fail('bank.example')]).dmarc, 'fail')
check('no headers at all', readAuth([]), { dmarc: null, domain: '' })

// ---------- The sender ----------

check('a friend whose mail verifies gets an intact seal', counts('דנה לוי', 'dana@levi.example'), ['intact', 0, 0])
check('the site that was verified is kept', sender('דנה לוי', 'dana@levi.example').verified, 'levi.example')
check('no verdict, no seal', counts('דנה לוי', 'dana@levi.example', []), [null, 0, 0])
check('a failed check breaks the seal', counts('דנה לוי', 'dana@levi.example', fail('levi.example')), ['broken', 1, 0])
check('a failed check through a mailing list says nothing', counts('דנה לוי', 'dana@levi.example', fail('levi.example'), { list: true }), [null, 0, 0])

check('the real bank is fine', counts('בנק הדוגמה', 'no-reply@bank-dugma.example'), ['intact', 0, 0])
check('the real bank from a sub-address is fine', counts('בנק הדוגמה', 'news@mail.bank-dugma.example', pass('mail.bank-dugma.example')), ['intact', 0, 0])
check('the fake bank that fails the check: broken', seal('בנק הדוגמה', 'security@bank-dugma-login.example', fail('bank-dugma-login.example')), 'broken')
check('the fake bank that passes the check gets no seal, and a note', counts('בנק הדוגמה', 'security@bank-dugma-login.example'), [null, 0, 1])
check('"the sender is known to me" puts the note away', counts('בנק הדוגמה', 'security@bank-dugma-login.example', pass('bank-dugma-login.example'), { trusted: true }), ['intact', 0, 0])

check('Bank Leumi from its own site', seal('בנק לאומי', 'info@mail.leumi.co.il', pass('mail.leumi.co.il')), 'intact')
check('"בנק לאומי" from elsewhere: a note', counts('בנק לאומי - עדכון חשוב', 'alert@secure-update.example'), [null, 0, 1])
check('PayPal from elsewhere: a note', counts('PayPal', 'service@pay-secure.example'), [null, 0, 1])
check('a near-copy of PayPal: broken', counts('Support', 'help@paypa1.com'), ['broken', 1, 0])
check('"rn" for "m": broken', seal('Microsoft', 'account@rnicrosoft.com'), 'broken')
check('one letter too many: broken', seal('Google', 'no-reply@gooogle.com'), 'broken')
check("PayPal's name inside another address: a note", counts('Billing', 'billing@paypal-secure-login.example'), [null, 0, 1])
check("PayPal's site as a sub-address of another: a note", counts('Billing', 'billing@paypal.com.verify.example'), [null, 0, 1])
check('a man called Max is not the card company', counts('מקס שטרן', 'max.stern@friends.example'), ['intact', 0, 0])
check('a football club is not the health fund', counts('מכבי תל אביב', 'news@maccabi-tlv.example'), ['intact', 0, 0])
check('"yes" alone from elsewhere: a note', counts('yes', 'offers@tv-deals.example'), [null, 0, 1])
check('a shop called "Partner Plus" is left alone', counts('Partner Plus', 'hello@partnerplus.example'), ['intact', 0, 0])
check('Gmail itself is fine', counts('Google', 'no-reply@accounts.google.com', pass('accounts.google.com')), ['intact', 0, 0])
check('the tax authority from gov.il is fine', seal('רשות המסים', 'noreply@taxes.gov.il', pass('taxes.gov.il')), 'intact')
check('the tax authority from elsewhere: a note', counts('רשות המסים בישראל', 'refund@tax-il.example'), [null, 0, 1])

check('a name that shows another address: broken', counts('service@paypal.com', 'x@other.example'), ['broken', 1, 1])
check('a name that shows its own address is fine', counts('dana@levi.example', 'dana@levi.example'), ['intact', 0, 0])
check('two alphabets in one address: broken', seal('Apple', 'id@аpple.com', []), 'broken')
check('an address in another script: a note', counts('חנות', 'info@xn--4dbcagdahymbxekheh6e0a7fei0b.example', []), [null, 0, 1])

// ---------- Links ----------

check('a link that says one site and leads to another', linkRisk('https://www.bank-dugma.example/login', 'https://bank-dugma-login.example/verify?id=7731'), {
  why: 'other-site',
  target: 'bank-dugma-login.example',
  shown: 'www.bank-dugma.example',
})
check('a link that says where it leads', linkRisk('www.example.com/help', 'https://example.com/help?x=1'), null)
check('a sub-address of the same site is the same site', linkRisk('example.co.il', 'https://shop.example.co.il/cart'), null)
check('words are not a site', linkRisk('לכל המבצעים', 'https://naalayim.example/sale'), null)
check('a sentence with a dot is not a site', linkRisk('Read more.', 'https://example.com/a'), null)
check('a link to a bare number', linkRisk('לכניסה לחשבון', 'http://203.0.113.9/login'), { why: 'number', target: '203.0.113.9' })
check('click counting in a newsletter is left alone', linkRisk('shop.example', 'https://click.mailer.example/abc', { list: true }), null)
check('…unless the letter already looks off', linkRisk('shop.example', 'https://click.mailer.example/abc', { list: true, flagged: true })?.why, 'other-site')
check('a shortened link in a letter that looks off', linkRisk('לחצו כאן', 'https://bit.ly/3xYz', { flagged: true }), { why: 'short', target: 'bit.ly' })
check('a shortened link in an ordinary letter', linkRisk('לחצו כאן', 'https://bit.ly/3xYz'), null)
check("Outlook's wrapping is looked through", linkRisk('https://example.com/report', 'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Freport&data=05'), null)
check('…and what hides behind it is still caught', linkRisk('https://bank.example/login', 'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fbank-login.example%2Fx&data=05')?.target, 'bank-login.example')
check("Google's redirect is looked through", linkRisk('example.org/page', 'https://www.google.com/url?q=https://example.org/page&sa=D'), null)
check("Proofpoint's wrapping is looked through", linkRisk('https://example.com/a', 'https://urldefense.com/v3/__https://example.com/a__;!!Abc123$'), null)
check('a mail link is left alone', linkRisk('dana@levi.example', 'mailto:dana@levi.example'), null)
check('nonsense is left alone', linkRisk('x', 'not a link'), null)

// ---------- Tracking marks ----------

check('a one-pixel picture', isTracker({ src: 'https://track.naalayim.example/open.gif?u=4821&m=77', width: '1', height: '1' }), true)
check('a hidden picture', isTracker({ src: 'https://shop.example/a.png', style: 'display: none' }), true)
check('a picture sized to nothing in its style', isTracker({ src: 'https://shop.example/a.png', style: 'width:1px;height:1px' }), true)
check('a known service', isTracker({ src: 'https://shop.us1.list-manage.com/track/open.php?u=abc&id=1' }), true)
check('a host that says what it is', isTracker({ src: 'https://open.mailer.example/o.gif' }), true)
check('a real banner', isTracker({ src: 'https://shop.example/banner.jpg', width: '600', height: '200' }), false)
check('a real banner on a tracking host', isTracker({ src: 'https://track.shop.example/banner.png', width: '600' }), false)
check('a spacer one pixel high but wide', isTracker({ src: 'https://shop.example/spacer.gif', width: '600', height: '1' }), false)
check('a picture inside the letter', isTracker({ src: 'cid:logo@shop', width: '1', height: '1' }), false)
check('a picture written into the letter', isTracker({ src: 'data:image/gif;base64,R0lGOD', width: '1', height: '1' }), false)
check('one mark', countMarks(1), 'הוסר סימן מעקב אחד')
check('several marks', countMarks(3), 'הוסרו 3 סימני מעקב')

if (failed) {
  console.error('\nthe inspector got something wrong')
  process.exit(1)
}
console.log('\nthe inspector is in order')
