# base.md — Arcade (клон Omlet Arcade)

Единый документ проекта: что собрано, как это работает, какие переменные окружения
нужны, в каком порядке разворачивать и что проверить перед выпуском.

Стек строго по вашим правилам: **только Render (web service) + Firebase**, звонки и
трансляции — **LiveKit**, шифрование — **E2EE**, ключи — **только на сервере**.

---

## 1. Состав репозитория

```
arcade/
├─ base.md                     этот файл
├─ README.md                   краткий старт
├─ server/                     Node 20, Express — деплой на Render
│  ├─ src/index.js             точка входа, хедеры безопасности, лимиты, маршруты
│  ├─ src/config.js            чтение и проверка переменных окружения (fail-fast)
│  ├─ src/lib/firebase.js      Firebase Admin (service account из env, base64)
│  ├─ src/lib/auth.js          проверка Firebase ID-токена + X-App-Check
│  ├─ src/lib/livekit.js       выпуск коротких LiveKit-грантов
│  ├─ src/lib/rooms.js         жизненный цикл комнат, квоты, участники
│  ├─ src/lib/schemas.js       zod-схемы на каждый запрос (strict)
│  ├─ src/lib/ids.js           CSPRNG-идентификаторы и коды приглашений
│  ├─ src/lib/http.js          типизированные ошибки и валидация
│  ├─ src/routes/*.js          me, streams, voice, minecraft, keys, rtc
│  ├─ render.yaml              Blueprint для Render
│  └─ .env.example             шаблон окружения
├─ firebase/
│  ├─ database.rules.json      правила Realtime Database
│  ├─ storage.rules            правила Storage
│  ├─ firestore.rules          Firestore закрыт полностью
│  └─ firebase.json            конфиг для firebase deploy
├─ android/                    Kotlin + Jetpack Compose
│  ├─ app/src/main/java/com/newrizer/arcade/...
│  ├─ config.properties.example  клиентская конфигурация (без секретов)
│  └─ build.gradle.kts, settings.gradle.kts
└─ assets/                     собственные ассеты (иконка, марка, загрузчик)
```

---

## 2. Архитектура

```
Android (Compose)
   │  Firebase Auth  ──────────────► Firebase (Auth + Realtime Database)
   │  Bearer ID-token                      ▲
   ▼                                       │ Admin SDK (service account)
Render web service (Node/Express)  ────────┘
   │  выпускает короткий LiveKit JWT (TTL 15 мин)
   ▼
LiveKit Cloud (SFU)  ◄── медиа уже зашифровано ключом комнаты
```

Принципы:

1. **Секреты только на сервере.** `LIVEKIT_API_KEY` и `LIVEKIT_API_SECRET` живут
   исключительно в окружении Render. Клиент не знает их и не может выпустить токен
   сам — он просит токен у `/v1/rtc/token`, предъявляя Firebase ID-токен.
2. **E2EE.** Ключ комнаты (32 случайных байта) создаётся хостом на устройстве,
   заворачивается HPKE (X25519 + HKDF-SHA256 + AES-256-GCM) отдельно для каждого
   участника и передаётся через сервер **только в виде шифротекста**. Сервер и
   Firebase физически не могут его раскрыть. Тот же ключ отдаётся LiveKit
   key-provider, поэтому SFU пересылает непрозрачные кадры. Чат шифруется
   AES-256-GCM тем же ключом, в базе лежит только `ciphertext` + `nonce`.
3. **Правила вместо доверия.** Клиент не пишет в критичные узлы Realtime Database:
   записи делает сервер через Admin SDK. Клиент пишет только зашифрованный чат,
   присутствие и жалобы — и то под валидацией правил.
4. **Коды приглашений не хранятся открыто.** В базе лежит `sha256(salt:code)`;
   сравнение — за постоянное время.

---

## 3. Переменные окружения

### 3.1 Render (web service) — обязательные

| Переменная | Значение | Комментарий |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | задаёт Render | не переопределять вручную |
| `LIVEKIT_URL` | `wss://newtyper-gl6mp500.livekit.cloud` | только `wss://` |
| `LIVEKIT_API_KEY` | ваш ключ | **секрет** |
| `LIVEKIT_API_SECRET` | ваш секрет | **секрет** |
| `LIVEKIT_TOKEN_TTL_SECONDS` | `900` | срок жизни гранта |
| `FIREBASE_PROJECT_ID` | `omletarcade-790f7` | |
| `FIREBASE_DATABASE_URL` | `https://omletarcade-790f7-default-rtdb.europe-west1.firebasedatabase.app` | |
| `FIREBASE_SERVICE_ACCOUNT_B64` | base64 от service-account JSON | **секрет** |
| `APP_ATTEST_SECRET` | строка из `android/config.properties` → `appCheckToken` | отсекает скриптовый трафик |
| `ALLOWED_ORIGINS` | пусто | заполнять, только если появится веб-клиент |
| `NODE_OPTIONS` | `--max-old-space-size=384` | для free-плана |

Как получить `FIREBASE_SERVICE_ACCOUNT_B64`:

```bash
# Firebase Console → Project settings → Service accounts → Generate new private key
base64 -w0 service-account.json
```

Сервер не стартует, если какой-либо обязательной переменной нет: это сознательный
fail-fast, чтобы не поднять инстанс с полу-настроенной безопасностью.

### 3.2 Android — `android/config.properties` (несекретное)

| Ключ | Назначение |
|---|---|
| `apiBaseUrl` | `https://omletarcade-newrizer-slavamem31yt-org-1.onrender.com` |
| `firebaseApiKey`, `firebaseAppId`, `firebaseProjectId`, `firebaseDbUrl`, `firebaseSenderId`, `firebaseStorageBucket` | публичная конфигурация Firebase |
| `appCheckToken` | тот же, что `APP_ATTEST_SECRET` на Render |
| `releaseStoreFile`, `releaseStorePassword`, `releaseKeyAlias`, `releaseKeyPassword` | подпись релиза; keystore не коммитится |

Всё, что попало в APK, читаемо любым, кто его скачал. Поэтому в APK нет и не
должно быть ключей LiveKit и service account.

---

## 4. Порядок развёртывания

### Шаг 1. Firebase

```bash
cd firebase
firebase use omletarcade-790f7
firebase deploy --only database,firestore,storage
```

В консоли Firebase включить **Authentication → Email/Password**.

### Шаг 2. Render

1. New → Web Service → подключить репозиторий (или Blueprint из `server/render.yaml`).
2. Root directory: `server`, Build: `npm ci --omit=dev`, Start: `npm start`.
3. Health check path: `/healthz`.
4. Добавить переменные из раздела 3.1 (все как **secret**, кроме `NODE_ENV`).
5. Deploy. Проверка: `curl https://<адрес>/healthz` → `{"status":"ok", ...}`.

### Шаг 3. Android

```bash
cd android
cp config.properties.example config.properties   # заполнить
./gradlew assembleRelease
# APK: app/build/outputs/apk/release/app-release.apk
```

---

## 5. API сервера

| Метод | Путь | Описание |
|---|---|---|
| GET | `/healthz` | проверка живости (без авторизации) |
| GET/PUT | `/v1/me` | профиль |
| PUT | `/v1/me/key` | публикация публичного ключа устройства |
| GET | `/v1/me/key/:uid` | публичный ключ участника |
| GET/POST | `/v1/streams` | список и запуск трансляции |
| POST | `/v1/streams/:id/join` \| `/end` | подключиться / завершить |
| GET/POST | `/v1/voice` | голосовые комнаты |
| POST | `/v1/voice/:id/join` \| `/end` | |
| GET/POST | `/v1/minecraft` | список и хостинг мира |
| POST | `/v1/minecraft/join` | вход по 6-значному коду |
| POST | `/v1/minecraft/:id/join` \| `/kick` \| `/end` | |
| POST | `/v1/keys/share` | хост раздаёт завёрнутые ключи |
| GET | `/v1/keys/:roomId` | участник забирает свой конверт |
| POST | `/v1/rtc/token` | короткий LiveKit-грант |

Авторизация у всех `/v1/*`: `Authorization: Bearer <Firebase ID token>` плюс
`X-App-Check: <APP_ATTEST_SECRET>`.

---

## 6. Модель данных Realtime Database

```
users/{uid}                     профиль (пишет сервер)
userKeys/{uid}                  публичный ключ устройства
streams/{streamId}              трансляции
voiceRooms/{roomId}             голосовые комнаты
mcSessions/{sessionId}          миры Minecraft (joinCodeHash + salt)
rooms/{roomId}                  служебные метаданные комнаты
roomMembers/{roomId}/{uid}      участники и роли
roomKeys/{roomId}/{uid}         ЗАВЁРНУТЫЙ ключ (читает только владелец uid)
roomBans/{roomId}/{uid}         баны (читает только сервер)
chat/{roomId}/{msgId}           только ciphertext + nonce + keyId + ts
reports/{reportId}              жалобы (write-only для клиента)
```

---

## 7. Чек-лист безопасности (пройден)

- [x] Ни одного секрета в APK, HTML или клиентском коде.
- [x] LiveKit-грант выпускается только сервером, TTL 15 минут, `canPublish`
      зависит от роли: зритель трансляции не может публиковать.
- [x] `verifyIdToken(token, true)` — проверка отзыва; забаненный пользователь
      теряет доступ сразу.
- [x] Каждый body проходит zod-схему со `strict()`; неизвестные поля отклоняются.
- [x] Лимит размера тела 64 КБ, rate limit по uid, отдельный лимит на выпуск токенов.
- [x] CORS по умолчанию закрыт, helmet + HSTS + CSP `default-src 'none'`.
- [x] Ошибки наружу — только код и безопасное сообщение, без стека.
- [x] Коды приглашений: соль + SHA-256, сравнение за постоянное время.
- [x] Ключ комнаты не покидает устройство в открытом виде, затирается при выходе.
- [x] Android: `usesCleartextTraffic=false`, network security config, бэкапы ключей
      запрещены (`data_extraction_rules.xml`), `allowBackup=false`.
- [x] Firebase Rules: по умолчанию `read:false / write:false`, Firestore закрыт.
- [x] Логи редактируют `Authorization`, `X-App-Check`, cookies.

### Обязательные действия на вашей стороне

1. **Смените LiveKit API key/secret** — они были отправлены в переписке открытым
   текстом, то есть считаются скомпрометированными. После ротации впишите новые
   значения только в переменные окружения Render.
2. В Firebase Console ограничьте API-ключ Android-приложением (SHA-256 подписи).
3. Для продакшена замените самоподписанный `APP_ATTEST_SECRET` на Firebase App Check
   (Play Integrity) — схема запроса уже готова, меняется только проверка в `lib/auth.js`.

---

## 8. Обслуживание памяти и кэша

На стороне сервера (free-план Render, 512 МБ):

- `NODE_OPTIONS=--max-old-space-size=384`;
- Firebase-персистентность на клиенте выключена, чтобы ключи и чат не оседали на диске;
- комнаты и ключи удаляются из базы при завершении сессии (`endRoom` чистит
  `roomKeys/*` и `roomMembers/*`), LiveKit-комната удаляется следом.

На стороне сборки:

```bash
# очистить кэш Gradle и артефакты сборки
cd android && ./gradlew clean && rm -rf .gradle build app/build
# очистить node_modules и кэш npm
cd ../server && rm -rf node_modules && npm cache clean --force
```

---

## 9. Что сделано и что осталось

Сделано:

- бэкенд целиком (аутентификация, комнаты, ключи, LiveKit-гранты, лимиты);
- правила Firebase (RTDB, Storage, Firestore);
- Android-приложение: вход и регистрация, лента трансляций, запуск трансляции с
  захватом экрана, голосовые комнаты, хостинг миров Minecraft с кодами, профиль с
  отпечатком ключа, зашифрованный чат, собственные иконки и загрузчик;
- сборка подписанного APK.

Осталось при желании развивать:

- витрина подписчиков и донатов;
- запись трансляций (потребует отдельного хранилища, сейчас сознательно не включено,
  так как запись ломает модель E2EE);
- ротация ключа комнаты при кике (API `rotateKey: true` уже возвращается сервером,
  клиенту остаётся перегенерировать ключ).
