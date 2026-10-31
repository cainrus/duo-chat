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

export function connectServerLink(_opts: ServerLinkOptions): ServerLink {
  throw new Error('not implemented')
}
