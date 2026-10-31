# duo-chat — design

Date: 2026-10-31. Status: draft, awaiting owner approval.

## Intent and why

A private chat and voice/video calling app for exactly two people: the owner's
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
   Messages are ephemeral (1 hour) and never push; a ping button calls the
   friend into the chat.
2. **Voice call** and **video call** buttons in the chat. During a voice call,
   video can be switched on and off. During any call you can switch to the
   text/emoji chat view and the audio keeps going. Every mode has an
   "end call" button.
3. **Calling a friend who is not in the app** sends a push notification
   ("<name> is calling you"). No ringing phone-style screen with a ringtone
   when the app is closed: the notification is enough. When the callee has the
   app open, they see an incoming call and can accept it.
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

## Call attempt rules (owner's design)

Per caller, state machine on the server (the client only displays it):

1. Caller presses voice or video → push to the other side. The call button
   locks for a **cooldown** (my call: 2 minutes). If the callee opens the app
   during the cooldown, they see the incoming call.
2. After the cooldown the caller may call **once more** (same push, same
   cooldown).
3. Still no answer → the button shows **"nobody's home"** (icon + short
   text) and is locked.
4. The lock lifts when the other side calls back — whether or not the caller
   accepts that callback. After that the caller gets **one** attempt; if it is
   not answered, the button locks again.
5. Any lock lifts on its own **24 hours** after it started. After a 24h
   unlock the caller gets the full two attempts again.
6. A call that is answered resets everything for both sides.

My calls inside this: "answered" means the callee accepted the call; a text
message from the other side does not unlock (only a callback does, as the
owner said). Cooldown length lives in one config constant.

### Presence (owner's rule)

- A side is **present** while the app is visible, and for **1 minute** after
  it was hidden (switched away, screen off).
- A side is **absent** after 1 minute hidden or when the app is closed.
- Pushes go only to an absent side. To a present side, calls ring in the app
  and pings show in the app; nothing goes through push.

### Text messages (owner's rules)

- Text never sends a push. You can write as much as you like, at any time.
- **Text never touches the server** (owner). Messages go device-to-device over
  a WebRTC data channel, opened whenever both sides are in the app. The data
  channel is DTLS-encrypted by the browser; signaling that sets it up is E2E
  encrypted (see below).
- If the other side is not there, the message waits in the sender's outbox
  (on the sender's device) and is sent when both are in the app at the same
  time. If the sender closes the app, delivery waits until both are online.
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

### Ping button (owner's rules)

A "come to the chat" button. It is how you call someone into the chat without
a voice/video call.

- If the other side is present: an in-app nudge (sound + animation), no push,
  not counted.
- If the other side is absent: a push ("<name> зовёт в чат"), rationed:
  1. first ping → push;
  2. the next push is allowed after the same cooldown as calls;
  3. after the second push, no more ping pushes until the next day (my call:
     24 hours after the second push, matching the call rule);
  4. a reply from the other side (a message, a ping or a call) resets the
     counter.
- The ping button is never locked: while pushes are used up, pressing it
  still shows the nudge if the friend comes back. My call: the button shows
  a small "сегодня больше не позвать" state when no pushes are left.

Ping pushes and call pushes are counted separately.

### Ringing lifecycle (my calls)

- A call is a server-side pending call that lives at most until the caller's
  cooldown ends. The caller sees a "calling…" screen and can cancel.
- If the caller leaves the app or cancels, the pending call ends. No push goes
  back to the caller ("X answered" is out of scope).
- A callee who opens the app after the call ended (e.g. from a stale push)
  lands in the chat with a "missed call" marker and a big call-back button.
- Decline counts as an unanswered attempt and ends the caller's cooldown early
  (the caller sees "busy" at once instead of waiting).
- A cancelled call counts as an attempt too, so cancelling is not a way
  around the rules.
- Both sides call at the same moment → the calls merge into one connected
  call, which counts as answered.
- Both sides locked at once: they wait for the 24h timer. Accepted as rare.

## Screens (all icon-first, big touch targets)

- **Chat** (home): message list, input with a large emoji picker, three big
  buttons: ping, voice, video. Call and ping buttons show their state
  (countdown / "nobody's home" / pushes used up). My call (owner did not
  answer): a "friend is here" indicator, since presence decides whether a
  ping pushes and whether messages can go out now.
- **Incoming call** (app open): friend's avatar, accept / decline.
- **In call**: remote video (or avatar in voice mode), small self-view,
  buttons: mute, camera on/off, switch to chat, end call.
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
    push counters.
  - Push text stays generic ("<name> зовёт" / "<name> зовёт в чат").
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
- **Names and avatars** (my call): never in the repo. The adult enters the
  name and picks an avatar (from bundled generic pictures, no photo upload)
  during pairing; kept only on the device and exchanged over the data channel
  (never sent to the server). The service worker reads the peer's name from
  local storage for notification text.
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
- Exact visual design, avatars, colours, sounds.
- Reconnect behaviour on network blips.
- Test strategy; a two-browser local test harness is expected.
