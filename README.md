# duo-chat

Маленький чат для двух детей: сообщения, кнопка «позвать» и звонки со звуком и видео. Только два устройства, связанные друг с другом. Без аккаунтов, без рекламы, без аналитики, без посторонних людей.

Сделано для двух шестилетних друзей с iPad. Интерфейс на иконках, подписи по-русски. Сообщения удаляются с устройств через час.

Как устроена защита и как проверить, что сайт собран из этого кода, — в [SECURITY.md](SECURITY.md).

## Из чего состоит

- PWA на Vue 3 и Vite. Ставится на экран «Домой» (iPadOS 16.4+: push и микрофон работают только из установленного приложения, не из вкладки Safari).
- Один Cloudflare Worker с Durable Object на пару: соединяет устройства, ведёт звонки и отправляет push. Он же отдаёт сам сайт.
- Переписка идёт напрямую между устройствами, звонки — WebRTC, через Cloudflare TURN, если напрямую не получается.

## Как развернуть свою копию

1. Форкните репозиторий. Нужен аккаунт Cloudflare (бесплатного тарифа хватает).
2. Задайте секреты Worker'а (список есть и в `wrangler.toml`):

   ```sh
   pnpm exec wrangler secret put ADMIN_SECRET        # нужен взрослому, чтобы создать пару или сбросить её
   pnpm exec wrangler secret put VAPID_PUBLIC_KEY    # ключи Web Push, base64url
   pnpm exec wrangler secret put VAPID_PRIVATE_KEY
   pnpm exec wrangler secret put VAPID_SUBJECT       # mailto:ваш@адрес
   pnpm exec wrangler secret put TURN_KEY_ID         # ключ Cloudflare Realtime TURN
   pnpm exec wrangler secret put TURN_KEY_API_TOKEN
   ```

3. В настройках репозитория на GitHub (Settings → Secrets → Actions) добавьте `CLOUDFLARE_API_TOKEN` (права на Workers) и `CLOUDFLARE_ACCOUNT_ID`.
4. Запушьте в `main`. Сайт собирает и публикует GitHub Actions, вручную не деплойте: иначе `verify` не сойдётся.
5. Взрослый открывает сайт на первом устройстве, создаёт пару (понадобится `ADMIN_SECRET`) и показывает QR-код. На втором устройстве QR сканируют изнутри установленного приложения.

## Разработка

Нужны Node из `.node-version` и pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # фронтенд
pnpm worker:dev   # Worker локально; секреты для него — в .dev.vars (в git не попадает)
pnpm test
pnpm typecheck
pnpm build
node --experimental-strip-types scripts/check-dist-urls.ts dist   # в сборке нет сторонних адресов
```

Правила, которые нельзя нарушать: никаких запросов к сторонним серверам (CDN, шрифты, аналитика), никаких inline-скриптов и стилей, текст сообщений и секрет пары не уходят на сервер.

## Лицензия

MIT, см. [LICENSE](LICENSE).
