# duo-chat — design

Date: 2026-10-31. Status: draft, awaiting owner approval.

## Intent and why

A private chat and calling app for exactly two people: the owner's
6-year-old daughter and her friend (also 6). Like Telegram, but nothing to
install from a store and nobody else in it. The friend's family does not use
Telegram. The web was chosen as the one platform that covers both devices.

The code is public (open source) for a specific reason: the owner wants to tell
the friend's parents "give this link to your ChatGPT and let it judge whether
this is safe for our kids". The repository has to be readable and checkable by a
non-technical parent with an AI assistant.

## Users and devices

- Daughter: Android phone or tablet, Chrome.
- Friend: iPad, Safari. Roblox runs on the same iPad.
- Both are 6, so reading is weak: the UI works with almost no text.
- An adult does the one-time setup on each device.

## Goals

1. **Text chat with emoji** is the home screen. Two people, one conversation.
   Messages are ephemeral (1 hour). A message to an absent friend sends her a
   content-free «онлайн» push; an «онлайн» button does the same on purpose.
2. **Calls without pressure** (owner, 2026-10-31): one call switch per side,
   OFF | AUDIO | VIDEO, in the chat. Calls are voice; video only when both
   chose it. No decline, no ring timeout, no call screen: the call happens
   inside the chat, which stays usable. See "Call switch and voice room".
3. **Calling a friend who is not in the app** sends a push notification
   (the same content-free «онлайн» as everything else). No ringing phone-style screen with a ringtone
   when the app is closed: the notification is enough. When the callee has the
   app open, her AUDIO button glows and a soft chime plays; tapping it joins.
4. **Anti-spam on calling** (owner's rules, see "Call attempt rules").
5. **Installable as a PWA**: an icon on the home screen, push notifications.
6. **Public repo written for review**: plain-language explanation of what data
   exists, where it goes, and what is never collected.

## Non-goals (v1)

- Keeping voice running while the friend plays Roblox on the iPad. iPadOS
  suspends a backgrounded web page and its microphone; only a native iOS app
  fixes this. Accepted: the call pauses or drops when the iPad user leaves the
  app. On Android, background audio may just work; it is a bonus, not a
  requirement.
- Parental controls of any kind: no parent view of messages, no quiet hours,
  no kill switch. Owner said explicitly: none.
- More than two people, contacts, search, groups, profiles.
- Voice messages, file/photo sending, stickers beyond system emoji.
- Native apps.

## Anti-goals (would be a failure even if it works)

- Any way for a third person to join, see or message the kids.
- Any analytics, trackers, ads, third-party scripts, external fonts or CDNs
  in the page.
- A UI a 6-year-old cannot use alone after setup.
- Notification spam that makes the friend's parents uninstall it. The call
  attempt rules exist for this.
- Security claims in the README that the code does not back up.

## Call switch and voice room (owner's decisions, 2026-10-31)

The owner changed the call design to remove any pressure between the kids.

- **One switch per side: OFF | AUDIO | VIDEO.** Each side sets only its own;
  what both get is the lower of the two. Tapping is the only control: there is
  no separate accept, decline, mute, camera or end button.
- **From OFF only AUDIO.** VIDEO is disabled while OFF and stays locked for
  3 seconds after AUDIO turned on (`VIDEO_UNLOCK_MS`), shown with a lock, so a
  mis-tap never lands a kid in video.
- **Voice room ("huddle") model.** My AUDIO while the friend is OFF means I
  enter the call and wait for her. I stay as long as my app is visible: no
  ring timeout. The moment my page is hidden (screen off, app switched, tab
  hidden, page closed) while I am still alone, my switch goes to OFF and the
  server cancels the call. My side shows a soft «ждём…».
- **Joining.** While I wait, her AUDIO glows with «Тебя зовут» and a soft
  WebAudio chime repeats (it stops by itself after a minute; the glow stays;
  no animation under prefers-reduced-motion). Her tapping AUDIO joins. There
  is **no decline**: not joining is the answer, and nothing tells me she saw it.
- **Microphone only when both are in.** No getUserMedia while I only wait (no
  mic light). The mic opens when the server reports the call connected, and
  goes to the direct link then. If the mic cannot be opened, the error shows
  and the call ends cleanly.
- **Video only when both are on VIDEO.** The switch position travels device to
  device over the data channel (`{ t: 'mode' }`, on change, on connect and on
  channel reopen), never through the server. Choosing VIDEO is one-sided and
  silent: the friend sees no prompt, highlight or hint, and neither do I;
  they ask each other by voice. When both are on VIDEO, both cameras open and
  video shows. When either leaves VIDEO, both cameras stop (light off) and
  their tracks are removed: back to voice. VIDEO -> AUDIO keeps the call.
- **Ending.** Either side going OFF ends the call for both; both switches
  return to OFF. Once connected, hiding the page does not end the call (Android
  keeps the audio in the background); only OFF or a lost connection does.

### Call attempt rules (owner's design)

Per caller, state machine on the server (the client only displays it):

1. Caller enters the voice room → one push to the other side (no repeats).
   The attempt counts at entry.
2. When the caller leaves without the friend joining (OFF, app hidden or
   closed), the AUDIO position pauses for a **cooldown** of 1 minute
   (`CALL_COOLDOWN_MS`, owner 2026-10-31). After it the caller may enter
   **once more**.
3. Still no answer → AUDIO shows **"nobody's home"** (icon + short text) and
   is locked.
4. The lock lifts when the other side calls back — whether or not the caller
   joins that callback. After that the caller gets **one** attempt; if it is
   not answered, the button locks again.
5. Any lock lifts on its own **24 hours** after it started. After a 24h
   unlock the caller gets the full two attempts again.
6. A call that is answered resets everything for both sides.

My calls inside this: "answered" means the callee joined; a text message from
the other side does not unlock (only a callback does, as the owner said).
Cooldown length lives in one config constant.

### Presence (owner's rule)

- A side is **present** while the app is visible, and for **1 minute** after
  it was hidden (switched away, screen off).
- A side is **absent** after 1 minute hidden or when the app is closed.
- Pushes go only to an absent side. To a present side, calls ring in the app
  and messages just arrive.
- **Presence is never shown** (owner, 2026-10-31): no dot, no «здесь/нет».
  The server uses it only for push decisions and the device only to open the
  direct link; nothing on screen may reveal whether the friend is in the app.

### Text messages (owner's rules)

- You can write as much as you like, at any time. The text never goes through
  the server or a push; to an absent friend a message only triggers the
  content-free invitation (see "Invitations").
- **Text never touches the server** (owner). Messages go device-to-device over
  a WebRTC data channel, opened whenever both sides are in the app. The data
  channel is DTLS-encrypted by the browser; signaling that sets it up is E2E
  encrypted (see below).
- If the other side is not there, the message waits in the sender's outbox
  (on the sender's device) and is sent when both are in the app at the same
  time. If the sender closes the app, delivery waits until both are online.
  A message leaves the outbox only when the friend's device acks its id (a
  channel can look open for seconds after her page is gone); unacked ones are
  resent on every channel open and every 5 s while open, deduped by id.
  Until the ack the sender sees a small clock on her bubble.
- No delivery or read marks: the sender does not see whether it arrived.
- **Every message lives exactly 1 hour from the moment it was sent**,
  wherever it is (owner). Example: sent at 12:00, the friend opens the app at
  12:59, receives it, and it disappears from both screens at 13:00. The
  sender's timestamp travels with the message; the receiver deletes it at
  `sentAt + 1h`. Expired outbox messages are never sent. Clock skew between
  devices: my call, the receiver clamps by its own clock (a message is never
  shown longer than 1h after it arrived, never accepted if already expired by
  the sender's stamp).
- Messages are kept on the device (IndexedDB) only until expiry, so they
  survive a reload within the hour.

### Invitations: «онлайн», messages, voice room (owner's decisions, 2026-10-31)

Three things tell an absent friend "I am online": the «онлайн» button, a
message, and entering the voice room. They all look the same, share one
budget, and never reveal to the sender whether the friend is in the app.

- **One look, no pressure.** Every push is the same notification: title
  «Дуо», body «онлайн». No names, no emoji, nothing to act on. The trigger kind
  stays only in the notification's data and decides where a click leads.
- **One budget per sender**, counted on the server for all three triggers:
  the first is granted; the next only after `CALL_COOLDOWN_MS` (1 minute);
  after the second, nothing until 24 hours later. A reply from the friend (a
  message, «онлайн» or a call) resets it. The call-attempt rules still govern
  the voice switch itself; only the push for a room entry comes from this
  budget.
- **Indistinguishable for the sender.** The budget is spent the same way
  whether or not the friend is in the app, has push, or muted it; only an
  absent, pushable friend actually gets the push. A room entry decides at
  entry and pushes later if she leaves while it still waits. No result comes
  back to the sender (no toast); the button's own state is the feedback.
- **The «онлайн» button** (aria «Отправить статус онлайн») is always visible.
  After use it is disabled with a countdown ring and the seconds left (owner:
  so a kid does not tap it 10,000 times); when the budget is used up, a calm
  disabled «🌙 завтра». Taps on the disabled button do nothing (a tiny shake,
  none under prefers-reduced-motion). There are no in-app nudges.
- **Mute bell** (per device, in the chat header, «Уведомления вкл/выкл»). Off:
  this device gets no pushes at all; the server treats it like a device
  without a subscription. The choice is kept on the device and re-sent on
  every connect. Turning it on when the browser never allowed notifications
  runs the permission prompt first.
- **Lifetime.** Web Push TTL for every push is 1 hour (`INVITE_TTL_MS`).
  One tag (`duo`) with renotify, so a new notification replaces the old one: at
  most one on screen. Ping and message notifications carry `expiresAt` (+1 h);
  the next push closes expired ones before showing. A call notification has no
  expiry of its own (the caller may wait long). When the app is opened or comes
  back to the front, all duo notifications are closed. Browsers and iOS cannot
  dismiss a shown notification on a timer; these rules are the closest we get.

### Waiting lifecycle (voice room)

- A call is a server-side pending call with no timeout: it lives while the
  caller waits (app visible, socket open). The caller leaves by going OFF;
  hiding or closing the app, or a dropped socket, also ends it.
- No push goes back to the caller ("X answered" is out of scope).
- A callee who opens the app after the caller left (e.g. from a stale push)
  lands in the chat with a "missed call" marker and a call-back button.
- Leaving before the friend joined counts as an attempt, so leaving is not a
  way around the rules. There is no decline and no "busy".
- Both sides enter at the same moment → the calls merge into one connected
  call, which counts as answered.
- Both sides locked at once: they wait for the 24h timer. Accepted as rare.

## Screens (all icon-first, big touch targets)

- **Chat** — the only screen after setup (owner, 2026-10-31: "always start in
  the chat"). No names, pictures or presence anywhere: "me" is the right
  bubbles, "the friend" the left ones. The header holds only the offline sign
  and a bell that turns pushes to this device on or off. Under it a compact
  call bar: the call switch, one status line («ждём…», «Тебя зовут», the call
  timer, the cooldown countdown or «никого нет») and the «онлайн» button
  (ready, a countdown ring, or «🌙 завтра»). While both are
  on VIDEO, a video block (friend big, me small) sits above the messages. The
  message list and the input with a large emoji picker stay usable during a
  call; the friend's audio keeps playing. No incoming popup, no full-screen
  call view, no floating "back to call" bubble.
- **Setup** (adult, one time): pairing via secret link or QR, "add to home
  screen" instructions for iPad, notification permission request (iOS needs it
  triggered by a tap inside the installed PWA).

## How it gets made (my calls, owner delegated hosting)

- **Frontend:** Vue 3 + TypeScript + Vite (the owner's everyday stack), as a
  PWA with a service worker for push.
- **Hosting:** Cloudflare.
  - Pages serves the static app (start on `*.pages.dev`, custom domain later).
  - One Worker + one Durable Object for the pair: WebSocket signaling for
    WebRTC, presence, call attempt and ping state machines, sending Web Push
    (VAPID). No message storage.
  - Cloudflare TURN for relaying media when direct peer-to-peer fails (common
    across two home networks or mobile data). European edge locations keep
    latency low for Estonia. Not hermes: it is in Singapore.
- **Media:** WebRTC peer-to-peer, encrypted by the browser (DTLS-SRTP).
  Through TURN, the relay sees only encrypted packets. The server never sees
  audio or video.
- **End-to-end encryption of everything the server relays** (owner decided):
  WebRTC signaling (SDP offers/answers, ICE candidates) is encrypted and
  authenticated on the device before it reaches the server. Text does not
  go through the server at all.
  - One shared 256-bit pair secret, created on the first device at pairing.
    Keys derived with HKDF; AES-GCM for messages and signaling. Browser
    WebCrypto only, no crypto library.
  - Why signaling too: it carries the DTLS fingerprints. Authenticated
    signaling means the server cannot swap fingerprints and sit in the middle
    of the call, so media E2E holds even against a malicious server. It also
    hides IP addresses (ICE candidates) from the server.
  - The server is untrusted for content: it relays only ciphertext and stores
    no content. It still sees metadata: when someone connects, calls, pings,
    that a message was written (`wrote`, never its text), push counters and
    whether a device muted pushes.
  - Push text is one fixed line for everything («Дуо» / «онлайн»).
- **Identity and pairing:** no accounts, no passwords, exactly two device
  slots.
  - The adult opens setup on the first device; it generates the pair secret
    and shows a pairing link/QR. The secret travels in the URL fragment
    (`#…`), which browsers never send to a server.
  - The owner gives the link to the friend's parent out of band (QR at a
    playdate, or a messenger). Whoever sees the link can pair, so it is
    single-use: the server accepts the second slot once, then pairing closes.
  - Each device also gets a random device token for the server's access
    check (who may connect to the pair's room).
  - Re-pairing a lost device: adult-only reset that creates a new pair secret
    and a new link; old device tokens are revoked.
- **No names and no avatars** (owner, 2026-10-31): there are only two people,
  so the UI is "me" and "the friend". Nothing personal is entered at setup,
  stored, exchanged or shown.
- **Server secrets** (VAPID private key, TURN credentials, admin reset
  secret) live in Cloudflare secrets, never in the repo. The pair secret
  never reaches the server at all.
- **Deploy from the public repo** through GitHub Actions so the parents' AI
  can see that what runs is built from what is published.
- **Language:** Russian for the UI labels, README and SECURITY.md (owner).
  The few UI labels sit next to icons. Code, comments and this spec stay in
  English.
- **Retention:** the server holds no messages. Devices delete each message
  1 hour after sending (owner). No call logs beyond what the attempt and ping
  rules need.

## The repository as a review target

- Public GitHub repo under the owner's account, MIT license (my call).
- `README.md` in plain language, short: what it is, who can use it, how to set
  it up.
- `SECURITY.md` is short and does NOT restate what the code already says
  (owner). It holds only what the code cannot show by itself:
  - the trust model in a few lines: the server is untrusted for content,
    everything it relays is E2E encrypted; what metadata it still sees;
  - where to look: pointers to the few files that matter (crypto module,
    pairing, CSP, Worker entry), so a reviewer reads code, not prose;
  - how to run `verify` against the live site.
- **Proof that the site is built from this repo** (owner asked):
  - Deploy only from GitHub Actions; the Actions log is public and names the
    commit.
  - Reproducible frontend build (pinned lockfile and Node version, no
    timestamps in output), so the same commit gives byte-identical files.
  - The workflow publishes a signed build provenance attestation
    (`actions/attest-build-provenance`, Sigstore) for the built files.
  - The site serves `/version.json` with the commit sha and a SHA-256 of
    every served file.
  - A `verify` script in the repo: given the site URL, it downloads every
    served file, rebuilds that commit locally and compares hashes. Anyone
    (or their AI) can run it.
  - Together with E2E encryption this covers the server too: the Worker code
    cannot be inspected from outside, but it never holds a key, so a
    different server could only drop or delay messages, not read or fake
    them. The verified frontend is the whole trust root.
- Strict Content-Security-Policy with no third-party origins except the TURN
  servers.

## Constraints

- iPad: iPadOS 16.4+ for web push in an installed PWA. Push and the mic only
  work from the home-screen icon, not a Safari tab.
- Cost: should stay in free tiers at this scale.
- Owner is a frontend developer; anything server-side should stay small and
  readable.

## Left to the builder

- Library choices (WebRTC helper or plain API, Web Push library that runs in
  Workers, emoji picker).
- Exact visual design, colours, sounds.
- Reconnect behaviour on network blips.
- Test strategy; a two-browser local test harness is expected.
