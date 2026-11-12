// Checks the notification encryption (supabase/functions/postman/webpush.ts) against the
// worked example in RFC 8291, and that a message survives a round trip.
//
//   node --experimental-strip-types scripts/check-webpush.ts

import { b64url, createVapidKeys, encrypt, fromB64url, vapidHeader } from '../supabase/functions/postman/webpush.ts'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
let failed = false

function check(name: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed = true
}

const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const

/** A P-256 key pair from the raw values the RFC prints. */
async function keyPair(privateKey: string, publicKey: string): Promise<CryptoKeyPair> {
  const point = fromB64url(publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(point.slice(1, 33)), y: b64url(point.slice(33)) }
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, ecdh, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', point, ecdh, true, []),
  }
}

/** What the browser does when a message arrives (RFC 8291, receiving side). */
async function decrypt(body: Uint8Array<ArrayBuffer>, receiver: CryptoKeyPair, authSecret: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16)
  const keyLength = body[20]!
  const senderPublic = body.slice(21, 21 + keyLength)
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))
  const senderKey = await crypto.subtle.importKey('raw', senderPublic, ecdh, false, [])
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, receiver.privateKey, 256)
  const hkdf = async (hkdfSalt: Uint8Array<ArrayBuffer>, secret: ArrayBuffer, info: Uint8Array<ArrayBuffer>, length: number) => {
    const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
    return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info }, key, length * 8)
  }
  const keyInfo = new Uint8Array([...encoder.encode('WebPush: info\0'), ...receiverPublic, ...senderPublic])
  const material = await hkdf(authSecret, shared, keyInfo, 32)
  const contentKey = await hkdf(salt, material, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, material, encoder.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + keyLength)))
  return plain.slice(0, plain.lastIndexOf(2))
}

// ---- 1. The example from RFC 8291, section 5 and appendix A.
const rfc = {
  plaintext: 'When I grow up, I want to be a watermelon',
  receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const sealed = await encrypt(
  encoder.encode(rfc.plaintext),
  { p256dh: rfc.receiverPublic, auth: rfc.auth },
  { salt: fromB64url(rfc.salt), senderKeys: await keyPair(rfc.senderPrivate, rfc.senderPublic) },
)
check('encryption matches the RFC 8291 example byte for byte', b64url(sealed) === rfc.body)

// ---- 2. A fresh message with random keys, in Hebrew, read back the way a browser would.
const receiver = await crypto.subtle.generateKey(ecdh, true, ['deriveBits'])
const auth = crypto.getRandomValues(new Uint8Array(16))
const message = JSON.stringify({ type: 'mail', title: 'דנה', body: 'שלום! מה שלומך?' })
const fresh = await encrypt(encoder.encode(message), {
  p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))),
  auth: b64url(auth),
})
check('a Hebrew message survives the round trip', decoder.decode(await decrypt(fresh, receiver, auth)) === message)

// ---- 3. The server's signature verifies with its public key and names the right audience.
const keys = await createVapidKeys()
const header = await vapidHeader('https://push.example.net/send/abc', keys, 'https://example.org')
const [, token = '', publicKey = ''] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? []
const [head = '', claims = '', signature = ''] = token.split('.')
const verifier = await crypto.subtle.importKey('raw', fromB64url(publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, fromB64url(signature), encoder.encode(`${head}.${claims}`))
const parsed = JSON.parse(decoder.decode(fromB64url(claims))) as { aud: string; exp: number; sub: string }
check('the server signature verifies', valid && fromB64url(signature).length === 64)
check('the signature names the push service and expires within a day', parsed.aud === 'https://push.example.net' && parsed.exp - Date.now() / 1000 < 86400)

if (failed) process.exit(1)
