// Prints a fresh VAPID key pair for Web Push, in the format the Worker expects:
// public = raw uncompressed P-256 point (65 bytes), private = the 32-byte scalar d, both base64url.
// Usage: node --experimental-strip-types scripts/make-vapid-keys.ts

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])) as CryptoKeyPair
const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
if (!jwk.d) throw new Error('no private scalar in JWK')

console.log(`VAPID_PUBLIC_KEY=${b64url(publicRaw)}`)
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`)
