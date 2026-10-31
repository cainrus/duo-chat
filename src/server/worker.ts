// Worker entry: HTTP routes under /api, everything else is static assets (the PWA).
// Routes are listed in src/shared/protocol.ts and implemented in ./routes.ts.

import { handleApi } from './routes'

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
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await handleApi(request, env)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
