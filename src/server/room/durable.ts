// Durable Object: one instance per pair (id = roomId).
// Owns: device tokens (slots a/b), WebSockets (hibernation API), RoomCore state in storage,
// alarms (RoomCore.nextAlarmAt), Web Push delivery for 'push' effects.
// Implemented by the server task.

import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../worker'

export class PairRoom extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response('not implemented', { status: 501 })
  }
}
