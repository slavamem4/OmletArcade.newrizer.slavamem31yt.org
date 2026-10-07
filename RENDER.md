# Deploying the backend to Render

One web service serves the API, the WebSocket and the static client from `web/`.
All secrets live only in the service environment; nothing secret ships in the
APK or the HTML/JS.

## 1. Create the resources

1. **New → PostgreSQL** (basic is enough). Note the internal `DATABASE_URL`.
2. **New → Web Service**, connect the repo (or upload `server/` + `web/` as-is).
   - **Root Directory:** the folder that contains `server/package.json` if the
     repo root is this project, otherwise leave empty and adjust the commands.
   - **Runtime:** Node
   - **Build Command:** `npm --prefix server ci`
   - **Start Command:** `npm --prefix server start`
   - **Health Check Path:** `/api/system/ready`
   - **Plan:** any; the anti-DDoS limits assume one instance (rate buckets are
     in-process). If you scale out, move buckets to Redis first.

## 2. Environment variables

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | enables strict secret checks |
| `DATABASE_URL` | from the Postgres page | switches the db facade to `pg` |
| `JWT_SECRET` | `openssl rand -base64 48` | access-token signing key, 32+ bytes |
| `LIVEKIT_URL` | `wss://….livekit.cloud` | your LiveKit cloud project |
| `LIVEKIT_API_KEY` | the project API key | server-side only |
| `LIVEKIT_API_SECRET` | the project secret | **rotate the old one: it was pasted into a chat once** |
| `PUBLIC_URL` | `https://<service>.onrender.com` | used in bootstrap + cookies |

Optional tuning (sane defaults are built in): `RL_IP_PER_MINUTE`,
`RL_IP_BURST`, `POW_DIFFICULTY_BITS`, `CACHE_MAX_ENTRIES`,
`RETENTION_MESSAGES_PER_CHANNEL`.

## 3. Verify

- `GET /api/system/health` → 200 JSON
- `GET /api/system/ready` → 200 once Postgres migrations ran (first boot)
- Open `https://<service>.onrender.com/` → the app shell loads, CSP header
  pins `script-src 'self'`.

## 4. Point the APK at it

In `mobile/android/app/src/main/res/values/strings.xml` set `server_url` to
the same `PUBLIC_URL`, then build:

```
tools/setup_android.sh        # downloads JDK + SDK if missing
JAVA_HOME=<jdk> ANDROID_HOME=<sdk> GRADLE_USER_HOME=<cache> \
  gradle -p mobile/android assembleDebug
```

The debug APK lands in `mobile/android/app/build/outputs/apk/debug/`.
A prebuilt copy ships in `release/omlet-arcade-debug.apk`.

## What stays secret

Only `LIVEKIT_API_SECRET`, `LIVEKIT_API_KEY` and `JWT_SECRET` can sign rooms or
tokens. The client receives short-lived room JWTs from `/api/*/voice`; the
bootstrap endpoint exposes the LiveKit **URL** (public by design) and never a
key. `server/tools/audit-secrets.js` greps every served asset and API response for
the configured secrets so a regression fails the build.
