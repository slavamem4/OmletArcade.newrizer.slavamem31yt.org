# PRODUCT.md — Omlet Arcade (functional clone)

## What it is
A mobile-first multiplayer arcade companion app: a faithful functional clone of
Omlet Arcade. Voice parties, direct calls, Minecraft server hosting/coordination,
live broadcast, friends, lobbies, profile — running as an Android app (Capacitor
shell over the web app) against a hardened Node backend deployed on Render, with
real-time voice over LiveKit Cloud.

## Audience and scene
Mobile gamers, phone in hand, often on mobile data, in a dark room at night,
headset on, mid-session in Minecraft or a shooter. The app is a side channel to
the game: it must be reachable in one or two taps, must not steal the screen,
and must keep working when the phone is locked or the game is in the foreground.

## Unique mechanism
Voice that survives a game running on top of it: a party room you join once and
stay in, with Minecraft coordination (who hosts, what the address is, who is in)
pinned next to the mic controls instead of buried in a chat log.

## Surfaces (Operate mode — design serves the task)
| Surface | Visitor success |
|---|---|
| Auth (sign in / sign up) | Account exists in under a minute, error names the fix |
| Home / Lobby | Sees live parties, friends online, broadcasts; joins in one tap |
| Party room | In voice, sees who is speaking, controls own mic, invites friends |
| Direct call | Call rings, connects, can be declined, ends cleanly |
| Minecraft hosting | Host a server entry, share address, run voice for the crew |
| Broadcast | Screen + mic published, viewers list, stop cleanly |
| Friends | Request, accept, block, see presence, open a DM or call |
| Chat (DM / lobby) | Read history, send, E2EE indicator, no lost messages |
| Feed | What friends are doing right now; jump into it |
| Profile | Identity, level, badges, edit, share |
| Settings | Account, privacy, voice devices, notifications, security, E2EE, cache purge |
| Moderation (admin) | Ban/mute/report handling, server load, blocked IPs |

## Non-negotiable constraints (from the brief)
1. Secrets never leave the server. No API key, token, or LiveKit secret in HTML,
   JS, the APK, git, or logs. The client only ever receives short-lived,
   room-scoped LiveKit JWTs.
2. End-to-end encryption for user content: X25519 key agreement, AES-256-GCM
   message frames, WebRTC encoded-transform media encryption. The server relays
   ciphertext and cannot read it.
3. Anti-DDoS at the edge of the app: layered per-IP + per-account budgets,
   escalation to temporary bans, WebSocket throttling, payload caps, load shed.
4. No emoji anywhere in the UI. Drawn SVG icons only, one stroke system.
5. Design follows the pinned brief (dark arcade world, no purple). No invented
   visual language.
6. Every feature the original ships is present and findable in seconds.
7. Memory/disk hygiene: bounded caches with TTL + size eviction, and an in-app
   purge that actually deletes cache, old logs, and stale records.

## Platform truth
- Android first. Capacitor shell, WebView UI, system back gesture honored,
  edge-to-edge insets, 48 dp touch targets, foreground service for voice.
- Web build of the same app is the dev surface and the fallback.
- Backend: Node 20 on Render (web service, Docker), Postgres in production,
  SQLite for local runs, in-memory bounded caches.

## Out of scope
- iOS packaging, store submission, payments/monetization, web admin panel
  beyond the in-app moderation screen, server-side recording of E2EE media.
