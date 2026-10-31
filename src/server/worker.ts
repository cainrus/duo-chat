// Worker entry: HTTP routes under /api, everything else is static assets (the PWA).
// Routes are listed in src/shared/protocol.ts. Implemented by the server task.

export type Env = {
  ROOMS: DurableObjectNamespace
  ASSETS: Fetcher
  ADMIN_SECRET: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  TURN_KEY_ID: string
  TURN_KEY_API_TOKEN: string
}

export { PairRoom } from './room/durable'

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('not implemented', { status: 501 })
  },
} satisfies ExportedHandler<Env>
