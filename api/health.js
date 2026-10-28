// Comprobación rápida del despliegue: https://TU-PROYECTO.vercel.app/api/health
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
};
