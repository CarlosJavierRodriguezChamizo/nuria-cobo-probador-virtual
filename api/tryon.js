// Probador virtual Nuria Cobo · función serverless para Vercel (Node 18+)
// Recibe la foto de la clienta + la imagen de la prenda y devuelve la imagen generada.
// No guarda nada: la foto solo viaja en memoria hasta OpenAI y se descarta.

const OPENAI_URL = 'https://api.openai.com/v1/images/edits';
const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const QUALITY = process.env.IMAGE_QUALITY || 'medium'; // low | medium | high
const SIZE = process.env.IMAGE_SIZE || '1024x1536';
const MAX_PER_IP = Number(process.env.MAX_TRIES_PER_IP || 6); // pruebas por persona y día
const MAX_PER_DAY = Number(process.env.MAX_TRIES_PER_DAY || 300); // tope global diario (control de gasto)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://nuriacobo.com,https://www.nuriacobo.com')
  .split(',').map((s) => s.trim()).filter(Boolean);
const GARMENT_HOSTS = ['cdn.shopify.com', 'nuriacobo.com', 'www.nuriacobo.com'];
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// Límite en memoria (por instancia). Suficiente para la prueba; en producción usar Vercel KV / Upstash.
const counters = { day: '', global: 0, ips: new Map() };
function allow(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (counters.day !== today) { counters.day = today; counters.global = 0; counters.ips.clear(); }
  if (counters.global >= MAX_PER_DAY) return 'global';
  const n = counters.ips.get(ip) || 0;
  if (n >= MAX_PER_IP) return 'ip';
  counters.ips.set(ip, n + 1);
  counters.global += 1;
  return 'ok';
}

const PROMPT = [
  'Virtual try-on for a fashion e-commerce store.',
  'Image 1 is a photo of a real customer. Image 2 is a product photo of a garment.',
  'Generate a realistic photo of the SAME person from image 1 wearing the garment from image 2.',
  'Preserve exactly: the face, facial features, skin tone, age, hair, body shape and proportions, pose, hands, background, lighting and camera framing of image 1. Do not beautify, slim, rejuvenate or change the person in any way.',
  'Transfer the garment faithfully: same colour, fabric texture, pattern or print scale, neckline, sleeves, length, buttons and details as in image 2. Ignore any model, mannequin or background in image 2.',
  'Only replace the clothing items that the garment would replace; keep everything else from image 1 (other garments, shoes and accessories) unless they would be covered.',
  'The garment should fit naturally to this body with realistic folds and drape. Photorealistic, natural light, no text, no watermark, no logos added.'
].join(' ');

function cors(req, res) {
  const origin = req.headers.origin || '';
  const ok = ALLOWED_ORIGINS.includes(origin);
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  return ok;
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function fetchGarment(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'https:' || !GARMENT_HOSTS.includes(u.hostname)) return null;
  const r = await fetch(u.toString());
  if (!r.ok) return null;
  const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
  return { type, buffer: Buffer.from(await r.arrayBuffer()) };
}

module.exports = async function handler(req, res) {
  const originOk = cors(req, res);
  if (req.method === 'OPTIONS') return res.status(originOk ? 204 : 403).end();
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!originOk) return send(res, 403, { error: 'origin_not_allowed' });
  if (!process.env.OPENAI_API_KEY) return send(res, 500, { error: 'missing_api_key' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (body.consent !== true) return send(res, 400, { error: 'consent_required' });

  const photo = dataUrlToBuffer(body.photo);
  if (!photo || photo.buffer.length > MAX_PHOTO_BYTES) return send(res, 400, { error: 'invalid_photo' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const verdict = allow(ip);
  if (verdict !== 'ok') return send(res, 429, { error: verdict === 'ip' ? 'limit_ip' : 'limit_global' });

  try {
    const garment = await fetchGarment(body.garment);
    if (!garment) return send(res, 400, { error: 'invalid_garment' });

    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', PROMPT);
    form.append('size', SIZE);
    form.append('quality', QUALITY);
    form.append('output_format', 'jpeg');
    form.append('output_compression', '85');
    form.append('n', '1');
    const ext = (t) => t.split('/')[1].replace('jpeg', 'jpg');
    form.append('image[]', new Blob([photo.buffer], { type: photo.type }), 'persona.' + ext(photo.type));
    form.append('image[]', new Blob([garment.buffer], { type: garment.type }), 'prenda.' + ext(garment.type));

    const r = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: form
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = data && data.error && data.error.code;
      console.error('openai_error', r.status, code, data && data.error && data.error.message);
      if (code === 'moderation_blocked' || code === 'content_policy_violation') return send(res, 422, { error: 'moderation' });
      return send(res, 502, { error: 'generation_failed' });
    }
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return send(res, 502, { error: 'empty_result' });
    return send(res, 200, { image: 'data:image/jpeg;base64,' + b64 });
  } catch (err) {
    console.error('tryon_exception', err && err.message);
    return send(res, 500, { error: 'server_error' });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
