const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BODY_CHARS = 20_000;
const MAX_PROMPT_CHARS = 1_800;

export async function onRequestPost({ request, env }) {
  let rawBody;
  let body;
  try {
    rawBody = await request.text();
    if (rawBody.length > MAX_BODY_CHARS) return json({ error: 'Запит завеликий.', code: 'REQUEST_TOO_LARGE' }, 413);
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Некоректний JSON.', code: 'INVALID_JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Очікується JSON-об’єкт.', code: 'INVALID_REQUEST' }, 400);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'Напиши опис зображення.', code: 'PROMPT_REQUIRED' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Опис має бути не довшим за 1800 символів.', code: 'PROMPT_TOO_LONG' }, 400);
  if (!env.AI) return json({ error: 'AI-ядро не підключене.', code: 'AI_BINDING_MISSING' }, 503);
  try {
    const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 });
    const encodedImage = typeof result?.image === 'string'
      ? result.image
      : typeof result === 'string'
        ? result
        : null;
    if (encodedImage) {
      const image = encodedImage.startsWith('data:image/')
        ? encodedImage
        : 'data:image/png;base64,' + encodedImage;
      return json({ image });
    }
    const payload = result?.image ?? result;
    const bytes = payload instanceof ReadableStream
      ? await new Response(payload).arrayBuffer()
      : payload;
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
      throw new Error('Unsupported image output');
    }
    const data = bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!data.length) throw new Error('Empty image output');
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
      binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
    }
    return json({ image: 'data:image/png;base64,' + btoa(binary) });
  } catch (error) {
    console.error('NOVA image generation failed:', error);
    return json({
      error: 'Не вдалося створити зображення. Перевір ліміти Workers AI та доступність моделі.',
      code: 'IMAGE_GENERATION_FAILED'
    }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
