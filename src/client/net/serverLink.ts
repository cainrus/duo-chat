// WebSocket link to the pair's room on the server.
// Sends `hello` first on every (re)connect, then the current visibility, then queued frames.
// Reconnects with exponential backoff (default 1s..30s) until close() is called.

import type { ClientToServer, ServerToClient } from '@shared/protocol'

export type LinkStatus = 'connecting' | 'open' | 'closed'

export interface ServerLink {
  readonly status: LinkStatus
  /** Queued while not open; `hello` is handled internally and must not be sent by callers. */
  send(msg: Exclude<ClientToServer, { t: 'hello' }>): void
  onMessage(cb: (msg: ServerToClient) => void): () => void
  onStatus(cb: (status: LinkStatus) => void): () => void
  /** Remembered and re-sent after each reconnect. */
  setVisible(visible: boolean): void
  close(): void
}

export type ServerLinkOptions = {
  /** e.g. "wss://duo.example" */
  wsBase: string
  roomId: string
  deviceToken: string
  WebSocketImpl?: typeof WebSocket
  backoff?: { minMs: number; maxMs: number }
}

type Outgoing = Exclude<ClientToServer, { t: 'hello' }>

const DEFAULT_BACKOFF = { minMs: 1_000, maxMs: 30_000 }

/**
 * Status semantics: 'connecting' while a socket is being opened, 'open' once it is open
 * (hello already sent), 'closed' while waiting for the next attempt and after close().
 *
 * The backoff resets on the first frame received from the server after a (re)connect,
 * not on `open`: a server that accepts the socket and drops it right away (e.g. a revoked
 * token) must not cause a reconnect loop at the minimum delay.
 */
export function connectServerLink(opts: ServerLinkOptions): ServerLink {
  const Impl = opts.WebSocketImpl ?? globalThis.WebSocket
  const backoff = opts.backoff ?? DEFAULT_BACKOFF
  const url = `${opts.wsBase.replace(/\/+$/, '')}/api/rooms/${encodeURIComponent(opts.roomId)}/ws`

  const messageCbs = new Set<(msg: ServerToClient) => void>()
  const statusCbs = new Set<(status: LinkStatus) => void>()
  const queue: Outgoing[] = []

  let status: LinkStatus = 'connecting'
  let socket: WebSocket | null = null
  let isOpen = false
  let visible: boolean | null = null
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const setStatus = (next: LinkStatus) => {
    if (next === status) return
    status = next
    for (const cb of [...statusCbs]) cb(next)
  }

  const rawSend = (msg: ClientToServer) => {
    socket?.send(JSON.stringify(msg))
  }

  const detach = (ws: WebSocket) => {
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
  }

  const scheduleReconnect = () => {
    if (stopped || timer !== null) return
    const delay = Math.min(backoff.maxMs, backoff.minMs * 2 ** attempts)
    attempts++
    timer = setTimeout(() => {
      timer = null
      open()
    }, delay)
  }

  const onDrop = (ws: WebSocket) => {
    if (ws !== socket) return
    detach(ws)
    socket = null
    isOpen = false
    if (stopped) return
    setStatus('closed')
    scheduleReconnect()
  }

  const open = () => {
    if (stopped) return
    setStatus('connecting')
    let ws: WebSocket
    try {
      ws = new Impl(url)
    } catch (err) {
      console.debug('[serverLink] cannot create socket', err)
      setStatus('closed')
      scheduleReconnect()
      return
    }
    socket = ws
    let gotFrame = false
    ws.onopen = () => {
      if (ws !== socket) return
      isOpen = true
      rawSend({ t: 'hello', deviceToken: opts.deviceToken })
      if (visible !== null) rawSend({ t: 'visibility', visible })
      while (queue.length > 0 && socket === ws && isOpen) rawSend(queue.shift()!)
      setStatus('open')
    }
    ws.onmessage = (ev: MessageEvent) => {
      if (ws !== socket) return
      const msg = parseServerFrame(ev.data)
      if (!msg) {
        console.debug('[serverLink] dropped malformed frame')
        return
      }
      if (!gotFrame) {
        gotFrame = true
        attempts = 0
      }
      for (const cb of [...messageCbs]) cb(msg)
    }
    ws.onclose = () => onDrop(ws)
    ws.onerror = () => {
      // A close event follows; closing explicitly covers implementations that skip it.
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      onDrop(ws)
    }
  }

  open()

  return {
    get status() {
      return status
    },
    send(msg) {
      if (stopped) return
      if (isOpen) rawSend(msg)
      else queue.push(msg)
    },
    onMessage(cb) {
      messageCbs.add(cb)
      return () => messageCbs.delete(cb)
    },
    onStatus(cb) {
      statusCbs.add(cb)
      return () => statusCbs.delete(cb)
    },
    setVisible(v) {
      visible = v
      if (isOpen && !stopped) rawSend({ t: 'visibility', visible: v })
    },
    close() {
      if (stopped) return
      stopped = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      queue.length = 0
      const ws = socket
      socket = null
      isOpen = false
      if (ws) {
        detach(ws)
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
      setStatus('closed')
    },
  }
}

function parseServerFrame(data: unknown): ServerToClient | null {
  if (typeof data !== 'string') return null
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const t = (value as { t?: unknown }).t
  if (t !== 'view' && t !== 'signal' && t !== 'nudge' && t !== 'callEnded' && t !== 'error') return null
  return value as ServerToClient
}
