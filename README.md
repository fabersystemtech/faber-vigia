# Vigía de Faber System

Revisa una lista de sitios cada 5 minutos desde GitHub Actions y avisa por Telegram cuando uno deja de responder
(y cuando vuelve). Sin dependencias, sin servidor propio, gratis.

Todo lo propio vive en **secretos del repositorio** (Settings → Secrets and variables → Actions):

| Secreto | Qué es |
|---|---|
| `SITIOS` | Lista JSON de sitios: `[{ "nombre": "...", "url": "https://...", "encabezados": { } }]` |
| `TELEGRAM_TOKEN` | Token del bot de Telegram que envía los avisos |
| `TELEGRAM_CHAT` | Identificador del chat que recibe los avisos |

Los registros de Actions son públicos: el programa imprime solo cantidades, nunca nombres ni direcciones.

Para probar el aviso: Actions → Vigía → Run workflow → marcar "prueba".
