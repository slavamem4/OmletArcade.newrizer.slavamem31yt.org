# Безопасность — короткий список действий

1. **Смените ключи LiveKit.** `LIVEKIT_API_KEY` и `LIVEKIT_API_SECRET` были переданы
   открытым текстом в переписке, значит считаются скомпрометированными. Создайте
   новую пару в LiveKit Cloud и впишите её ТОЛЬКО в переменные окружения Render.
2. **Не публикуйте архив.** В нём лежат `android/keystore/release.jks` и
   `android/config.properties` с паролями подписи. Потеря keystore означает, что
   обновления приложения нельзя будет подписать тем же ключом.
3. **Service account Firebase не нужен.** Сервер работает без него. Если ключ
   успел создаться — удалите его: Google Cloud Console → IAM & Admin →
   Service Accounts → Keys. Неиспользуемый ключ это только риск.
4. Ограничьте Firebase API-ключ в Google Cloud Console: Application restrictions →
   Android apps → отпечаток SHA-256 вашего keystore.
5. Перед публикацией в Play замените статический `APP_ATTEST_SECRET` на Firebase
   App Check с Play Integrity.

Отпечаток текущего ключа подписи (SHA-256):
`80:FF:AF:2F:35:3F:48:C6:A6:16:44:B9:2B:CD:AF:EB:6E:60:A3:C6:E3:1A:A8:BD:A6:83:44:52:FD:04:92:F2`
