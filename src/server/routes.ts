// HTTP API under /api (see src/shared/protocol.ts). Kept apart from worker.ts so it can be
// unit-tested without the Workers runtime.

import type { ClaimResponse, IceResponse, RTCIceServerJSON, VapidKeyResponse } from '@shared/protocol'
import type { Side } from '@shared/types'
import { bearer, isAdmin } from './auth'
import type { RoomRpc } from './room/durable'
import type { Env } from './worker'

/** Room ids are 16 random bytes in base64url (22 chars), so they cannot be guessed. */
export const ROOM_ID = /^[A-Za-z0-9_-]{22}$/

/** TURN credentials live as long as the longest expected call. */
export const ICE_TTL_SECONDS = 3600

const TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys'

type Deps = { fetcher?: typeof fetch }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

const status = (code: number, text: string) =>
  new Response(text, { status: code, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } })

function room(env: Env, roomId: string): RoomRpc {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId)) as unknown as RoomRpc
}

/** Browsers block port 53, and a URL there only makes non-trickle ICE wait for a timeout. */
function dropPort53(servers: RTCIceServerJSON[]): RTCIceServerJSON[] {
  const ok = (u: string) => !/:53(\?|$)/.test(u)
  return servers.flatMap((s) => {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(ok)
    return urls.length ? [{ ...s, urls }] : []
  })
}

async function iceServers(env: Env, fetcher: typeof fetch): Promise<RTCIceServerJSON[] | null> {
  const res = await fetcher(`${TURN_API}/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: ICE_TTL_SECONDS }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { iceServers?: unknown }
  if (!Array.isArray(body.iceServers)) return null
  return dropPort53(body.iceServers as RTCIceServerJSON[])
}

/** Handles /api/*; returns null for anything else (static assets). */
export async function handleApi(request: Request, env: Env, deps: Deps = {}): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return null
  const fetcher = deps.fetcher ?? fetch
  const method = request.method

  if (url.pathname === '/api/vapid-public-key') {
    if (method !== 'GET') return status(405, 'method not allowed')
    return json({ key: env.VAPID_PUBLIC_KEY } satisfies VapidKeyResponse)
  }

  const m = /^\/api\/rooms\/([^/]+)(\/claim|\/ice|\/ws)?$/.exec(url.pathname)
  if (!m || !ROOM_ID.test(m[1]!)) return status(404, 'not found')
  const roomId = m[1]!
  const action = m[2] ?? ''

  if (action === '' && method === 'DELETE') {
    if (!(await isAdmin(request, env.ADMIN_SECRET))) return status(401, 'unauthorized')
    await room(env, roomId).wipe()
    return new Response(null, { status: 204 })
  }

  if (action === '/claim' && method === 'POST') {
    let side: Side
    try {
      const body = (await request.json()) as { side?: unknown }
      if (body.side !== 'a' && body.side !== 'b') return status(400, 'bad request')
      side = body.side
    } catch {
      return status(400, 'bad request')
    }
    if (side === 'a' && !(await isAdmin(request, env.ADMIN_SECRET))) return status(401, 'unauthorized')
    const r = await room(env, roomId).claim(side)
    if (!r.ok) return status(r.status, r.status === 409 ? 'pair is full' : 'no such room')
    return json({ side: r.side, deviceToken: r.deviceToken } satisfies ClaimResponse)
  }

  if (action === '/ice' && method === 'GET') {
    const token = bearer(request)
    if (!token || !(await room(env, roomId).sideForToken(token))) return status(401, 'unauthorized')
    const servers = await iceServers(env, fetcher)
    if (!servers) return status(502, 'turn unavailable')
    return json({ iceServers: servers } satisfies IceResponse)
  }

  if (action === '/ws' && method === 'GET') {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return status(426, 'expected websocket')
    return room(env, roomId).fetch(request)
  }

  return status(405, 'method not allowed')
}
