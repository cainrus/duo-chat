import { describe, expect, it, vi } from 'vitest'
import type { Side } from '@shared/types'
import { handleApi, ICE_TTL_SECONDS } from './routes'
import type { ClaimResult, RoomRpc } from './room/durable'
import type { Env } from './worker'

const ROOM = 'AbCdEfGhIjKlMnOpQrStUv' // 22 chars
const base = `https://duo.example/api/rooms/${ROOM}`

function setup(opts: { claim?: ClaimResult; tokenSide?: Side | null } = {}) {
  const calls: { method: string; arg?: unknown; name?: string }[] = []
  const stub: RoomRpc = {
    claim: vi.fn(async (side: Side) => {
      calls.push({ method: 'claim', arg: side })
      return opts.claim ?? ({ ok: true, side, deviceToken: 'tok' } as const)
    }),
    wipe: vi.fn(async () => {
      calls.push({ method: 'wipe' })
    }),
    sideForToken: vi.fn(async (t: string) => (t === 'good' ? (opts.tokenSide ?? 'a') : null)),
    fetch: vi.fn(async () => new Response('from-do', { status: 200 })),
  }
  const env = {
    ROOMS: {
      idFromName: (name: string) => {
        calls.push({ method: 'idFromName', name })
        return name
      },
      get: () => stub,
    },
    ASSETS: { fetch: async () => new Response('asset') },
    ADMIN_SECRET: 'admin-secret',
    VAPID_PUBLIC_KEY: 'vapid-pub',
    VAPID_PRIVATE_KEY: 'x',
    VAPID_SUBJECT: 'mailto:a@b.c',
    TURN_KEY_ID: 'kid',
    TURN_KEY_API_TOKEN: 'turn-token',
  } as unknown as Env
  return { env, stub, calls }
}

const post = (url: string, body: unknown, auth?: string) =>
  new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  })

describe('routes', () => {
  it('leaves non-API paths to static assets', async () => {
    const { env } = setup()
    expect(await handleApi(new Request('https://duo.example/index.html'), env)).toBeNull()
  })

  it('serves the VAPID public key', async () => {
    const { env } = setup()
    const res = (await handleApi(new Request('https://duo.example/api/vapid-public-key'), env))!
    expect(await res.json()).toEqual({ key: 'vapid-pub' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects malformed room ids', async () => {
    const { env } = setup()
    for (const id of ['short', `${ROOM}x`, 'AbCdEfGhIjKlMnOpQrSt.v']) {
      const res = (await handleApi(post(`https://duo.example/api/rooms/${id}/claim`, { side: 'b' }), env))!
      expect(res.status).toBe(404)
    }
  })

  it('slot a needs the admin secret, slot b does not', async () => {
    const { env, calls } = setup()
    expect((await handleApi(post(`${base}/claim`, { side: 'a' }), env))!.status).toBe(401)
    expect((await handleApi(post(`${base}/claim`, { side: 'a' }, 'wrong'), env))!.status).toBe(401)
    const ok = (await handleApi(post(`${base}/claim`, { side: 'a' }, 'admin-secret'), env))!
    expect(await ok.json()).toEqual({ side: 'a', deviceToken: 'tok' })
    const b = (await handleApi(post(`${base}/claim`, { side: 'b' }), env))!
    expect(await b.json()).toEqual({ side: 'b', deviceToken: 'tok' })
    expect(calls.find((c) => c.method === 'idFromName')?.name).toBe(ROOM)
  })

  it('passes 409 and 404 from the room, and 400 for a bad body', async () => {
    expect((await handleApi(post(`${base}/claim`, { side: 'b' }), setup({ claim: { ok: false, status: 409 } }).env))!.status).toBe(409)
    expect((await handleApi(post(`${base}/claim`, { side: 'b' }), setup({ claim: { ok: false, status: 404 } }).env))!.status).toBe(404)
    expect((await handleApi(post(`${base}/claim`, { side: 'c' }), setup().env))!.status).toBe(400)
    const notJson = new Request(`${base}/claim`, { method: 'POST', body: 'nope' })
    expect((await handleApi(notJson, setup().env))!.status).toBe(400)
  })

  it('DELETE wipes the room only with the admin secret', async () => {
    const { env, stub } = setup()
    expect((await handleApi(new Request(base, { method: 'DELETE' }), env))!.status).toBe(401)
    expect(stub.wipe).not.toHaveBeenCalled()
    const res = (await handleApi(new Request(base, { method: 'DELETE', headers: { Authorization: 'Bearer admin-secret' } }), env))!
    expect(res.status).toBe(204)
    expect(stub.wipe).toHaveBeenCalledOnce()
  })

  it('ICE needs a device token and asks Cloudflare TURN for 1h credentials, dropping port 53', async () => {
    const { env } = setup()
    const seen: { url: string; init: RequestInit }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Response.json(
        {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'],
              username: 'u',
              credential: 'c',
            },
          ],
        },
        { status: 201 },
      )
    }) as unknown as typeof fetch

    expect((await handleApi(new Request(`${base}/ice`), env, { fetcher }))!.status).toBe(401)
    expect((await handleApi(new Request(`${base}/ice`, { headers: { Authorization: 'Bearer bad' } }), env, { fetcher }))!.status).toBe(401)
    expect(seen).toHaveLength(0)

    const res = (await handleApi(new Request(`${base}/ice`, { headers: { Authorization: 'Bearer good' } }), env, { fetcher }))!
    expect(await res.json()).toEqual({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
      ],
    })
    expect(seen[0]!.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers')
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer turn-token')
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({ ttl: ICE_TTL_SECONDS })
  })

  it('ICE reports 502 when TURN fails', async () => {
    const fetcher = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch
    const res = (await handleApi(new Request(`${base}/ice`, { headers: { Authorization: 'Bearer good' } }), setup().env, { fetcher }))!
    expect(res.status).toBe(502)
  })

  it('forwards WebSocket upgrades to the room and refuses plain GETs', async () => {
    const { env, stub } = setup()
    expect((await handleApi(new Request(`${base}/ws`), env))!.status).toBe(426)
    const res = (await handleApi(new Request(`${base}/ws`, { headers: { Upgrade: 'websocket' } }), env))!
    expect(await res.text()).toBe('from-do')
    expect(stub.fetch).toHaveBeenCalledOnce()
  })

  it('404 for unknown API paths, 405 for wrong methods', async () => {
    const { env } = setup()
    expect((await handleApi(new Request('https://duo.example/api/nope'), env))!.status).toBe(404)
    expect((await handleApi(new Request(`${base}/claim`), env))!.status).toBe(405)
    expect((await handleApi(new Request('https://duo.example/api/vapid-public-key', { method: 'POST' }), env))!.status).toBe(405)
  })
})
