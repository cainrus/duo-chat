import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectServerLink, type LinkStatus } from './serverLink'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1)
    if (!ws) throw new Error('no socket')
    return ws
  }

  readonly sent: unknown[] = []
  closed = false
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    if (this.closed) throw new Error('send on closed socket')
    this.sent.push(JSON.parse(data))
  }

  close() {
    this.closed = true
  }

  // --- server side ---
  serverOpen() {
    this.onopen?.({})
  }
  serverSend(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  serverClose() {
    this.closed = true
    this.onclose?.({})
  }
}

const Impl = FakeWebSocket as unknown as typeof WebSocket

const make = (backoff = { minMs: 1000, maxMs: 30_000 }) =>
  connectServerLink({ wsBase: 'wss://duo.example/', roomId: 'room_1', deviceToken: 'tok', WebSocketImpl: Impl, backoff })

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('connectServerLink', () => {
  it('connects to the room ws url', () => {
    make()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.last().url).toBe('wss://duo.example/api/rooms/room_1/ws')
  })

  it('sends hello first, then visibility, then queued frames', () => {
    const link = make()
    link.send({ t: 'ping' })
    link.setVisible(true)
    link.send({ t: 'wrote' })
    const ws = FakeWebSocket.last()
    expect(ws.sent).toEqual([])
    ws.serverOpen()
    expect(ws.sent).toEqual([
      { t: 'hello', deviceToken: 'tok' },
      { t: 'visibility', visible: true },
      { t: 'ping' },
      { t: 'wrote' },
    ])
  })

  it('skips visibility until it is known, sends directly once open', () => {
    const link = make()
    const ws = FakeWebSocket.last()
    ws.serverOpen()
    expect(ws.sent).toEqual([{ t: 'hello', deviceToken: 'tok' }])
    link.setVisible(false)
    link.send({ t: 'callEnd' })
    expect(ws.sent.slice(1)).toEqual([{ t: 'visibility', visible: false }, { t: 'callEnd' }])
  })

  it('reports status changes', () => {
    const link = make()
    const seen: LinkStatus[] = []
    link.onStatus((s) => seen.push(s))
    expect(link.status).toBe('connecting')
    FakeWebSocket.last().serverOpen()
    expect(link.status).toBe('open')
    FakeWebSocket.last().serverClose()
    expect(link.status).toBe('closed')
    vi.advanceTimersByTime(1000)
    expect(link.status).toBe('connecting')
    FakeWebSocket.last().serverOpen()
    expect(seen).toEqual(['open', 'closed', 'connecting', 'open'])
  })

  it('delivers parsed server frames and drops malformed ones', () => {
    const link = make()
    const got: unknown[] = []
    const off = link.onMessage((m) => got.push(m))
    const ws = FakeWebSocket.last()
    ws.serverOpen()
    ws.serverSend({ t: 'callEnded', reason: 'hangup' })
    ws.serverSend('not json')
    ws.serverSend({ t: 'nudge' })
    ws.serverSend({ t: 'bogus' })
    ws.serverSend('42')
    ws.serverSend({ t: 'callEnded', reason: 'cancelled' })
    ws.serverSend({ t: 'pingResult', result: 'pushed' })
    off()
    ws.serverSend({ t: 'callEnded', reason: 'hangup' })
    expect(got).toEqual([
      { t: 'callEnded', reason: 'hangup' },
      { t: 'callEnded', reason: 'cancelled' },
    ])
  })

  it('reconnects with exponential backoff capped at max', () => {
    make({ minMs: 1000, maxMs: 5000 })
    const delays: number[] = []
    for (let i = 0; i < 5; i++) {
      FakeWebSocket.last().serverClose()
      const before = FakeWebSocket.instances.length
      let waited = 0
      while (FakeWebSocket.instances.length === before) {
        vi.advanceTimersByTime(100)
        waited += 100
      }
      delays.push(waited)
    }
    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000])
  })

  it('resets the backoff after the server talks, not on bare open', () => {
    make({ minMs: 1000, maxMs: 30_000 })
    FakeWebSocket.last().serverClose()
    vi.advanceTimersByTime(1000)
    // opened then dropped without a frame: delay keeps growing
    FakeWebSocket.last().serverOpen()
    FakeWebSocket.last().serverClose()
    vi.advanceTimersByTime(1999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
    // now the server sends a view: next drop retries after minMs
    FakeWebSocket.last().serverOpen()
    FakeWebSocket.last().serverSend({ t: 'callEnded', reason: 'hangup' })
    FakeWebSocket.last().serverClose()
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(4)
  })

  it('re-sends hello and the remembered visibility on every reconnect, keeps the queue', () => {
    const link = make()
    link.setVisible(true)
    FakeWebSocket.last().serverOpen()
    FakeWebSocket.last().serverClose()
    link.setVisible(false)
    link.send({ t: 'ping' })
    vi.advanceTimersByTime(1000)
    const ws = FakeWebSocket.last()
    expect(FakeWebSocket.instances).toHaveLength(2)
    ws.serverOpen()
    expect(ws.sent).toEqual([{ t: 'hello', deviceToken: 'tok' }, { t: 'visibility', visible: false }, { t: 'ping' }])
  })

  it('treats a socket error as a drop', () => {
    make()
    const ws = FakeWebSocket.last()
    ws.onerror?.({})
    expect(ws.closed).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('ignores events from a stale socket', () => {
    const link = make()
    const old = FakeWebSocket.last()
    const got: unknown[] = []
    link.onMessage((m) => got.push(m))
    old.serverClose()
    vi.advanceTimersByTime(1000)
    old.serverSend({ t: 'callEnded', reason: 'hangup' })
    old.serverOpen()
    expect(got).toEqual([])
    expect(link.status).toBe('connecting')
  })

  it('close() stops reconnecting and closes the socket', () => {
    const link = make()
    const seen: LinkStatus[] = []
    link.onStatus((s) => seen.push(s))
    const ws = FakeWebSocket.last()
    ws.serverOpen()
    link.close()
    expect(ws.closed).toBe(true)
    expect(link.status).toBe('closed')
    ws.serverClose()
    vi.advanceTimersByTime(120_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    link.send({ t: 'ping' })
    expect(ws.sent).toEqual([{ t: 'hello', deviceToken: 'tok' }])
    expect(seen).toEqual(['open', 'closed'])
  })

  it('close() during the backoff wait cancels the pending attempt', () => {
    const link = make()
    FakeWebSocket.last().serverClose()
    link.close()
    vi.advanceTimersByTime(120_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
