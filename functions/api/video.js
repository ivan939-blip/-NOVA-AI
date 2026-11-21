const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

const MAX_BODY_CHARS = 20_000;
const MAX_PROMPT_CHARS = 1_800;
const PROVIDER = 'https://apihub.agnes-ai.com';

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

export async function onRequest({ request, env }) {
  const key = env.AGNES_API_KEY;
  if (!key) return json({
    error: 'Генерація відео ще не налаштована для цього deployment.',
    code: 'VIDEO_PROVIDER_NOT_CONFIGURED'
  }, 503);

  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    if (request.method === "POST") {
      const rawBody = await request.text();
      if (rawBody.length > MAX_BODY_CHARS) return json({ error: 'Запит завеликий.', code: 'REQUEST_TOO_LARGE' }, 413);
      let body;
      try { body = JSON.parse(rawBody); } catch { return json({ error: 'Некоректний JSON.', code: 'INVALID_JSON' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Очікується JSON-об’єкт.', code: 'INVALID_REQUEST' }, 400);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return json({ error: 'Опиши відео.', code: 'PROMPT_REQUIRED' }, 400);
      if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Опис має бути не довшим за 1800 символів.', code: 'PROMPT_TOO_LONG' }, 400);
      const seconds = Math.max(4, Math.min(12, Number(body.seconds) || 5));
      const ratios = ["16:9","9:16","1:1","4:3","3:4","21:9"];
      const ratio = ratios.includes(body.aspect_ratio) ? body.aspect_ratio : "16:9";
      const response = await fetch(`${PROVIDER}/v1/videos`, { method: "POST", headers, body: JSON.stringify({ model: "agnes-video-2.5-flash", prompt, mode: "text", seconds: String(seconds), size: "720P", aspect_ratio: ratio }) });
      const data = await readJson(response);
      if (!response.ok) return json({ error: data.error?.message || data.message || 'Не вдалося створити завдання відео.', code: 'VIDEO_TASK_FAILED' }, response.status);
      return json(data, 202);
    }
    if (request.method === "GET") {
      const video_id = new URL(request.url).searchParams.get("video_id");
      if (!video_id || video_id.length > 200) return json({ error: 'Не вказано коректний video_id.', code: 'VIDEO_ID_REQUIRED' }, 400);
      const response = await fetch(`${PROVIDER}/agnesapi?video_id=${encodeURIComponent(video_id)}&model_name=agnes-video-2.5-flash`, { headers: { Authorization: `Bearer ${key}` } });
      const data = await readJson(response);
      if (!response.ok) return json({ error: data.error?.message || data.message || 'Не вдалося перевірити статус відео.', code: 'VIDEO_STATUS_FAILED' }, response.status);
      return json(data, response.status);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, OPTIONS' } });
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
  } catch (e) {
    console.error('NOVA video request failed:', e);
    return json({ error: 'Відеосервіс тимчасово недоступний.', code: 'VIDEO_PROVIDER_UNAVAILABLE' }, 502);
  }
}
