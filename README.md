# Probador virtual · Nuria Cobo

Función serverless que recibe la foto de la clienta y la foto de la prenda, llama a la API de imágenes de OpenAI (`gpt-image-2`, endpoint `/v1/images/edits`) y devuelve la imagen generada.

- **No guarda nada.** La foto solo pasa en memoria hacia OpenAI y se descarta.
- **Solo acepta peticiones desde nuriacobo.com** (variable `ALLOWED_ORIGINS`).
- **Límite de gasto:** `MAX_TRIES_PER_IP` pruebas por persona y día y `MAX_TRIES_PER_DAY` en total. El contador vive en memoria: vale para la prueba; para producción conviene pasarlo a Vercel KV / Upstash.

## Despliegue
1. Crea un proyecto nuevo en Vercel y sube esta carpeta (arrastrando el zip en vercel.com/new o con `vercel deploy`). No necesita framework ni build.
2. En Settings → Environment Variables añade `OPENAI_API_KEY` (y, si quieres, el resto de `.env.example`).
3. Vuelve a desplegar para que coja las variables.
4. Comprueba `https://TU-PROYECTO.vercel.app/api/health` → debe decir `"apiKeyConfigured": true`.
5. Pega `https://TU-PROYECTO.vercel.app/api/tryon` en Shopify → Contenido → Metaobjetos → Probador virtual → campo «Endpoint».

## Coste orientativo
Cada prueba es una llamada a `/v1/images/edits` con 2 imágenes de entrada y 1 de salida (1024x1536, calidad media). Revisa el precio vigente en la página de precios de OpenAI.
