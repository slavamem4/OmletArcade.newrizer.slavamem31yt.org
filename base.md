# base.md — Arcade (клон Omlet Arcade)

Единый документ проекта: что собрано, как это работает, какие переменные окружения
нужны, в каком порядке разворачивать и что проверить перед выпуском.

Стек строго по вашим правилам: **только Render (web service) + Firebase**, трансляции
и голос — **LiveKit**, шифрование — **E2EE**, секреты — **только на сервере**.

Версия архитектуры: **2.0 — без service account**. Сервер не держит привилегированных
учётных данных Firebase вообще.

---

## 1. Состав репозитория

```
arcade/
├─ base.md                     этот файл
├─ README.md                   краткий старт
├─ SECURITY.md                 обязательные действия по безопасности
├─ server/                     Node 20, Express — деплой на Render
│  ├─ src/index.js             точка входа, хедеры безопасности, лимиты, маршруты
│  ├─ src/config.js            чтение и проверка переменных окружения (fail-fast)
│  ├─ src/lib/identity.js      локальная проверка Firebase ID-токена по JWKS Google
│  ├─ src/lib/auth.js          Bearer-аутентификация, X-App-Check, блокировка аккаунта
│  ├─ src/lib/rtdb.js          чтение базы ОТ ИМЕНИ вызывающего (REST + его же токен)
│  ├─ src/lib/livekit.js       выпуск коротких LiveKit-грантов, ensureRoom/deleteRoom
│  ├─ src/lib/schemas.js       zod-схемы на каждый запрос (strict)
│  ├─ src/lib/http.js          типизированные ошибки и валидация
│  ├─ src/routes/rtc.js        единственный бизнес-маршрут: /v1/rtc/token, /v1/rtc/close
│  ├─ render.yaml              Blueprint для Render
│  └─ .env.example             шаблон окружения
├─ firebase/
│  ├─ database.rules.json      правила Realtime Database — главный контур защиты
│  ├─ firestore.rules          Firestore закрыт полностью
│  └─ firebase.json            конфиг для firebase deploy
├─ android/                    Kotlin + Jetpack Compose
│  ├─ app/src/main/java/com/newrizer/arcade/...
│  ├─ config.properties.example  клиентская конфигурация (без секретов)
│  └─ build.gradle.kts, settings.gradle.kts
├─ apk/                        собранный подписанный релиз
└─ assets/                     собственные ассеты (иконка, марка, загрузчик)
```

---

## 2. Архитектура

```
Android (Compose)
   │  Firebase Auth (ID-токен)
   ├──────────────────────────────► Firebase RTDB  — все данные, под правилами
   │                                      ▲
   │  Bearer ID-token                     │ REST ?auth=<тот же токен клиента>
   ▼                                      │
Render web service (Node/Express) ────────┘
   │  выпускает короткий LiveKit JWT (TTL 15 мин)
   ▼
LiveKit Cloud (SFU)  ◄── медиа уже зашифровано ключом комнаты
```

Принципы:

1. **У сервера один секрет — LiveKit.** `LIVEKIT_API_KEY` и `LIVEKIT_API_SECRET` живут
   только в окружении Render. Клиент не может выпустить токен сам: он просит его у
   `/v1/rtc/token`, предъявляя Firebase ID-токен.
2. **Никакого service account.** Подлинность пользователя проверяется локально:
   подпись ID-токена сверяется с публичным JWKS Google
   (`securetoken@system.gserviceaccount.com`), проверяются `iss`, `aud`, `exp`, `sub`.
   Это та же гарантия, что даёт Admin SDK.
3. **Отзыв доступа без Admin SDK.** Модератор ставит `users/{uid}/disabled = true`
   (клиент это поле писать не может — `".validate": false`). Сервер читает флаг
   перед выдачей токена и отказывает заблокированному аккаунту.
4. **Сервер читает базу от имени вызывающего.** `lib/rtdb.js` ходит в REST с
   `?auth=<ID-токен клиента>`, поэтому не может увидеть больше, чем сам пользователь.
   Отказ правил (401/403) трактуется как «данных нет».
5. **Правила — единственный контур записи.** Все записи делает клиент напрямую через
   Firebase SDK, а `database.rules.json` решает, что разрешено. Сервер не пишет в базу
   никогда.
6. **E2EE.** Ключ комнаты (32 случайных байта) создаётся хостом на устройстве,
   заворачивается HPKE (X25519 + HKDF-SHA256 + AES-256-GCM) отдельно для каждого
   участника и кладётся в `roomKeys/{roomId}/{uid}` **только шифротекстом**. Сервер и
   Firebase физически не могут его раскрыть. Тот же ключ отдаётся LiveKit
   key-provider, поэтому SFU пересылает непрозрачные кадры. Чат шифруется
   AES-256-GCM тем же ключом, в базе лежит только `ciphertext` + `nonce`.
7. **Код приглашения — секретный путь, а не хеш.** `joinIndex/{CODE}` читается только
   тем, кто знает код целиком (8 символов из алфавита `A-Z2-9`, 2^40 вариантов);
   листинг родительского узла правилами запрещён.
8. **Вместимость обеспечивает LiveKit.** Правила RTDB не умеют считать детей узла,
   поэтому лимит участников задаётся при создании комнаты в SFU
   (`ensureRoom(roomId, maxParticipants)`) — это жёсткий предел, который клиент обойти
   не может.
9. **Приватность ленты.** `rooms/{roomId}` виден только участникам и владельцу.
   Публичные карточки лежат отдельно в `listings/{stream|voice|mc}/{roomId}` и не
   содержат ничего чувствительного. Приватный мир Minecraft карточки не создаёт
   вообще — его видно только по коду.

---

## 3. Переменные окружения

### 3.1 Render (web service)

| Переменная | Значение | Комментарий |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | задаёт Render | не переопределять вручную |
| `LIVEKIT_URL` | `wss://newtyper-gl6mp500.livekit.cloud` | только `wss://` |
| `LIVEKIT_API_KEY` | ваш ключ | **секрет** |
| `LIVEKIT_API_SECRET` | ваш секрет | **секрет** |
| `LIVEKIT_TOKEN_TTL_SECONDS` | `900` | срок жизни гранта |
| `FIREBASE_PROJECT_ID` | `omletarcade-790f7` | используется как `aud` и часть `iss` |
| `FIREBASE_DATABASE_URL` | `https://omletarcade-790f7-default-rtdb.europe-west1.firebasedatabase.app` | |
| `APP_ATTEST_SECRET` | строка из `android/config.properties` → `appCheckToken` | отсекает скриптовый трафик |
| `ALLOWED_ORIGINS` | пусто | заполнять, только если появится веб-клиент |
| `NODE_OPTIONS` | `--max-old-space-size=384` | для free-плана |

Необязательные: `MAX_BODY_BYTES` (64 КБ), `TRUST_PROXY_HOPS` (1), `RATE_WINDOW_MS`
(60000), `RATE_GLOBAL_MAX` (120), `RATE_TOKEN_MAX` (20).

Переменной `FIREBASE_SERVICE_ACCOUNT_B64` **больше нет**. Ключ service account не
нужен, скачивать его не требуется, и политика Google Cloud
`iam.disableServiceAccountKeyCreation` проекту больше не мешает. Если ключ когда-либо
создавался — удалите его в консоли: он лишний и является риском.

Сервер не стартует, если какой-либо обязательной переменной нет: это сознательный
fail-fast, чтобы не поднять инстанс с полу-настроенной безопасностью.

### 3.2 Android — `android/config.properties` (несекретное)

| Ключ | Назначение |
|---|---|
| `apiBaseUrl` | `https://omletarcade-newrizer-slavamem31yt-org-1.onrender.com` |
| `firebaseApiKey`, `firebaseAppId`, `firebaseProjectId`, `firebaseDbUrl`, `firebaseSenderId` | публичная конфигурация Firebase |
| `appCheckToken` | тот же, что `APP_ATTEST_SECRET` на Render |
| `releaseStoreFile`, `releaseStorePassword`, `releaseKeyAlias`, `releaseKeyPassword` | подпись релиза; keystore не коммитится |

Всё, что попало в APK, читаемо любым, кто его скачал. Поэтому в APK нет и не должно
быть ключей LiveKit.

---

## 4. Порядок развёртывания

### Шаг 1. Firebase

```bash
cd firebase
firebase use omletarcade-790f7
firebase deploy --only database,firestore
```

В консоли Firebase включить **Authentication → Email/Password**.

Правила обязательны: без них новая схема не работает — именно они выполняют роль,
которую раньше играл Admin SDK.

### Шаг 2. Render

1. New → Web Service → подключить репозиторий (или Blueprint из `server/render.yaml`).
2. Root directory: `server`, Build: `npm ci --omit=dev --omit=optional`, Start: `npm start`.
3. Health check path: `/healthz`.
4. Добавить переменные из раздела 3.1 (как **secret**, кроме `NODE_ENV`).
5. Deploy. Проверка: `curl https://<адрес>/healthz` → `{"status":"ok", ...}`.

### Шаг 3. Android

```bash
cd android
cp config.properties.example config.properties   # заполнить
./gradlew assembleRelease
# APK: app/build/outputs/apk/release/app-release.apk
```

Готовый подписанный APK уже лежит в `apk/`.

---

## 5. API сервера

| Метод | Путь | Описание |
|---|---|---|
| GET | `/healthz` | проверка живости (без авторизации) |
| POST | `/v1/rtc/token` | `{roomId, publish}` → короткий LiveKit-грант |
| POST | `/v1/rtc/close` | `{roomId}` — владелец закрывает комнату в LiveKit |

Больше маршрутов нет. Профиль, ленты, комнаты, участники, ключи и чат — это прямые
операции клиента с Realtime Database под правилами.

Авторизация у всех `/v1/*`: `Authorization: Bearer <Firebase ID token>` плюс
`X-App-Check: <APP_ATTEST_SECRET>`.

Ответ `/v1/rtc/token`:

```json
{
  "roomId": "stream_ab12cd34ef56gh78ij90",
  "url": "wss://newtyper-gl6mp500.livekit.cloud",
  "token": "<JWT, TTL 900 c>",
  "expiresInSeconds": 900,
  "canPublish": true,
  "e2ee": true
}
```

Правила выдачи грантов: токен получает только участник (или владелец) живой комнаты;
зритель трансляции получает `canPublish=false`; `roomCreate` в гранте всегда выключен,
комнату материализует сервер через `ensureRoom` с лимитом участников.

---

## 6. Модель данных Realtime Database

```
users/{uid}                     профиль: displayName, avatarId, bio, createdAt, updatedAt
                                + disabled (пишется только из консоли, клиенту запрещено)
userKeys/{uid}                  публичный ключ устройства: keyId, publicKey, algorithm
rooms/{roomId}                  kind, ownerUid, ownerName, title, state, maxParticipants,
                                e2ee, createdAt, endedAt — читают только участники и владелец
listings/stream/{roomId}        публичная карточка трансляции (.indexOn createdAt)
listings/voice/{roomId}         публичная карточка голосовой комнаты
listings/mc/{roomId}            публичная карточка мира Minecraft (приватный мир её не имеет)
joinIndex/{CODE}                CODE (8 символов A-Z2-9) → roomId; читается только по знанию кода
roomMembers/{roomId}/{uid}      role, joinedAt
roomKeys/{roomId}/{uid}         ЗАВЁРНУТЫЙ ключ комнаты (читает только владелец uid)
roomBans/{roomId}/{uid}         баны (читать нельзя никому, пишет владелец комнаты)
chat/{roomId}/{msgId}           senderUid, ciphertext, nonce, keyId, ts (.indexOn ts)
reports/{reportId}              жалобы: write-only для клиента
```

Формат идентификатора комнаты: `(stream|voice|mc)_[a-z0-9]{20}`, генерируется на
устройстве из CSPRNG и проверяется регуляркой в правилах.

Порядок записей при создании сессии важен: правила видят `root` **до** записи, поэтому
клиент пишет сначала `rooms/{roomId}`, затем своё членство, и только потом карточку в
`listings` и код в `joinIndex`.

---

## 6.1 Тест правил (обязательный шаг при любой правке `database.rules.json`)

Правила — единственный контур авторизации записи, поэтому к ним приложен набор
тестов: `firebase/rules.test.mjs`, 67 сценариев (разрешения и отказы).

```bash
cd firebase
firebase emulators:start --only database --project demo-arcade   # нужен JDK 21+
node rules.test.mjs                                              # в другом терминале
# ожидаемый вывод: 67 passed, 0 failed
```

Тест покрывает: закрытый корень, профиль и неприкосновенность `disabled` и
`createdAt`, публикацию публичных ключей, создание комнаты и маску идентификатора,
публичные карточки, вход участника и запрет чужих ролей, коды приглашений (чтение по
точному коду и запрет листинга), раздачу завёрнутых ключей, чат (только шифротекст,
только участники), баны и кик, жалобы, закрытие сессии одной fan-out записью.

Деплой правил: `firebase deploy --only database`.

---

## 7. Чек-лист безопасности (пройден)

- [x] Ни одного секрета в APK, HTML или клиентском коде.
- [x] На сервере нет привилегированных учётных данных Firebase: максимум, что он
      умеет, — прочитать то, что уже доступно самому пользователю.
- [x] Подпись ID-токена проверяется по публичному JWKS Google: `iss`, `aud`, `exp`,
      `alg=RS256`, допуск часов 10 с, `auth_time` из будущего отклоняется.
- [x] Блокировка аккаунта: `users/{uid}/disabled = true` закрывает доступ к токенам.
- [x] LiveKit-грант выпускается только сервером, TTL 15 минут, `canPublish` зависит
      от роли: зритель трансляции не может публиковать; `roomCreate` выключен.
- [x] Вместимость комнаты задаётся в SFU и не зависит от честности клиента.
- [x] Каждый body проходит zod-схему со `strict()`; неизвестные поля отклоняются.
- [x] Лимит размера тела 64 КБ, rate limit по uid, отдельный лимит на выпуск токенов.
- [x] CORS по умолчанию закрыт, helmet + HSTS + CSP `default-src 'none'`.
- [x] Ошибки наружу — только код и безопасное сообщение, без стека.
- [x] Коды приглашений не хранятся в читаемом списке: узел-индекс без права листинга.
- [x] Ключ комнаты не покидает устройство в открытом виде, затирается при выходе.
- [x] Android: `usesCleartextTraffic=false`, network security config, бэкапы ключей
      запрещены (`data_extraction_rules.xml`), `allowBackup=false`.
- [x] Firebase Rules: корень `read:false / write:false`, каждое поле валидируется по
      типу, длине и формату; Firestore закрыт целиком.
- [x] Cloud Storage не используется и не подключается: он платный и проекту не нужен —
      аватар это число (`avatarId`), медиа идёт напрямую через LiveKit.
- [x] Логи редактируют `Authorization`, `X-App-Check`, cookies.

### Обязательные действия на вашей стороне

1. **Смените LiveKit API key/secret** — они были отправлены в переписке открытым
   текстом, то есть считаются скомпрометированными. После ротации впишите новые
   значения только в переменные окружения Render.
2. **Удалите service-account ключ**, если он успел создаться: Google Cloud Console →
   IAM & Admin → Service Accounts → Keys. Приложению он не нужен.
3. В Firebase Console ограничьте API-ключ Android-приложением (SHA-256 подписи).
4. Для продакшена замените самоподписанный `APP_ATTEST_SECRET` на Firebase App Check
   (Play Integrity) — схема запроса уже готова, меняется только проверка в `lib/auth.js`.

---

## 8. Обслуживание памяти и кэша

На стороне сервера (free-план Render, 512 МБ):

- `NODE_OPTIONS=--max-old-space-size=384`;
- процесс не держит состояния: кэшируется только JWKS Google (10 минут);
- при завершении сессии владелец удаляет `roomKeys/*`, `roomMembers/*`, карточку
  в `listings` и код в `joinIndex`; LiveKit-комната удаляется через `/v1/rtc/close`.

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

- бэкенд: проверка личности без service account, LiveKit-гранты, лимиты, заголовки;
- правила Firebase как полноценный контур авторизации записи;
- Android-приложение: вход и регистрация, лента трансляций, запуск трансляции с
  захватом экрана, голосовые комнаты, хостинг миров Minecraft с кодами, профиль с
  отпечатком ключа, зашифрованный чат, собственные иконки и загрузчик;
- сборка подписанного APK.

Осталось при желании развивать:

- витрина подписчиков и донатов;
- запись трансляций (потребует отдельного хранилища; запись ломает модель E2EE);
- ротация ключа комнаты при кике: сейчас кик удаляет копию ключа и ставит бан,
  полная ротация потребует перевыпуска ключа всем оставшимся.
