# Arcade

Android-приложение в духе Omlet Arcade: трансляции с экрана, голосовые комнаты,
хостинг миров Minecraft, зашифрованный чат. Бэкенд — один web service на Render,
база и аутентификация — Firebase, медиа — LiveKit, шифрование — end-to-end.

Полное описание, переменные окружения и порядок развёртывания: **[base.md](base.md)**.

## Быстрый старт

```bash
# 1. Правила Firebase
cd firebase && firebase deploy --only database,firestore

# 2. Бэкенд (Render): Root dir = server, Build = npm ci --omit=dev --omit=optional, Start = npm start
#    Переменные окружения — раздел 3.1 base.md

# 3. Android
cd android
cp config.properties.example config.properties   # заполнить
./gradlew assembleRelease
```

## Структура

| Каталог | Содержимое |
|---|---|
| `server/` | Express API: проверка личности по JWKS Google и короткие токены LiveKit |
| `firebase/` | правила Realtime Database и закрытый Firestore (Storage не используется) |
| `android/` | Kotlin + Jetpack Compose, LiveKit, Tink (HPKE), Firebase SDK |
| `assets/` | собственные ассеты: иконка, марка, анимация загрузки, генератор |

## Безопасность в двух строках

Единственный секрет сервера — ключи LiveKit, они живут только в переменных окружения
Render. Service account не используется: личность проверяется по публичным ключам
Google, а записи в базу разрешают правила Realtime Database.
Ключ комнаты создаётся на устройстве, передаётся завёрнутым под публичный ключ
каждого участника и никогда не виден серверу — поэтому ни Render, ни Firebase,
ни LiveKit не могут прочитать голос, экран или чат.
