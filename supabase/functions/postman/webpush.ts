// Web Push without a library: message encryption (RFC 8291, "aes128gcm") and the
// server's signature (VAPID, RFC 8292). Uses only WebCrypto, so the same file runs in
// the Edge Function and in Node (scripts/check-webpush.ts checks it against the RFC's example).

const encoder = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

/** What a browser hands over when it agrees to receive notifications. */
export type Subscription = { endpoint: string; p256dh: string; auth: string }

/** Only for checking against the RFC's example: the values that are normally random. */
export type Fixed = { salt: Uint8Array<ArrayBuffer>; senderKeys: CryptoKeyPair }

/** Encrypt a message so that only the subscribed browser can read it (RFC 8291). */
export async function encrypt(plaintext: Uint8Array, to: Pick<Subscription, 'p256dh' | 'auth'>, fixed?: Fixed) {
  const receiverPublic = fromB64url(to.p256dh)
  const authSecret = fromB64url(to.auth)
  const sender = fixed?.senderKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey))

  const receiverKey = await crypto.subtle.importKey('raw', receiverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256))
  const keyInfo = concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic)
  const material = await hkdf(authSecret, shared, keyInfo, 32)

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, material, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, material, encoder.encode('Content-Encoding: nonce\0'), 12)

  // One record: the message, then the byte that marks the last record.
  const key = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))))

  // Header: salt, record size, and the sender's public key (so the browser can derive the same keys).
  const header = new Uint8Array(21 + senderPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = senderPublic.length
  header.set(senderPublic, 21)
  return concat(header, sealed)
}

/** The server's key pair. The public half is what browsers subscribe with. */
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey }

export async function createVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  return {
    publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
}

/** The Authorization header that proves to the push service which server is sending (RFC 8292). */
export async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const part = (value: unknown) => b64url(encoder.encode(JSON.stringify(value)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)))
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`
}

export type PushResult = {
  status: number
  /** The browser dropped this subscription; forget it. */
  gone: boolean
  detail?: string
}

/** Send one notification. `payload` is what the app's service worker receives. */
export async function sendPush(
  to: Subscription,
  payload: unknown,
  keys: VapidKeys,
  options: { subject: string; ttlSeconds?: number; urgent?: boolean },
): Promise<PushResult> {
  try {
    const response = await fetch(to.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(to.endpoint, keys, options.subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttlSeconds ?? 24 * 3600),
        Urgency: options.urgent === false ? 'normal' : 'high',
      },
      body: await encrypt(encoder.encode(JSON.stringify(payload)), to),
      signal: AbortSignal.timeout(15_000),
    })
    const detail = response.ok ? undefined : (await response.text()).slice(0, 300)
    return { status: response.status, gone: response.status === 404 || response.status === 410, detail }
  } catch (error) {
    return { status: 0, gone: false, detail: error instanceof Error ? error.message : String(error) }
  }
}
