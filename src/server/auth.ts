// Device tokens: who may open the pair's room. The server stores only SHA-256 hashes,
// so a leaked storage dump does not let anyone connect.

import { toBase64url } from './base64url'

/** 32 random bytes, base64url. Given to the device once, at claim time. */
export function generateDeviceToken(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** SHA-256 of the token's UTF-8 bytes, base64url. This is what storage keeps. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return toBase64url(new Uint8Array(digest))
}

/** Compares two strings in time that depends only on their length. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  const n = Math.max(ea.length, eb.length)
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/** True if `token` hashes to `expectedHash`. Hashing first makes the comparison length-independent. */
export async function verifyToken(token: string, expectedHash: string | null | undefined): Promise<boolean> {
  if (!expectedHash) return false
  return constantTimeEqual(await hashToken(token), expectedHash)
}

/** Reads `Authorization: Bearer <value>`, or null. */
export function bearer(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('Authorization') ?? '')
  return m ? m[1]! : null
}

/** Admin check for creating and wiping a pair. Hashes both sides so timing reveals nothing. */
export async function isAdmin(request: Request, adminSecret: string | undefined): Promise<boolean> {
  const given = bearer(request)
  if (!given || !adminSecret) return false
  return constantTimeEqual(await hashToken(given), await hashToken(adminSecret))
}
