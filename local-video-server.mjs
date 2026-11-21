import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const port = Number(process.env.NOVA_VIDEO_PORT || 8189);
const host = process.env.NOVA_VIDEO_HOST || '127.0.0.1';
const comfyUrl = (process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const workflowPath = resolve(process.env.COMFYUI_WORKFLOW || 'comfyui/wan2.1-api-workflow.json');
const allowedOrigins = new Set((process.env.NOVA_ALLOWED_ORIGINS || 'https://nova-ai-7qd.pages.dev,http://localhost:5173')
  .split(',').map(value => value.trim()).filter(Boolean));
const MAX_BODY_CHARS = 20_000;
const MAX_PROMPT_CHARS = 1_800;

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.has(origin)) return send(res, 403, { error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' }, origin);
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600'
    });
    res.end();
    return true;
  }
  if (origin && !allowedOrigins.has(origin)) {
    send(res, 403, { error: 'Origin is not allowed.', code: 'ORIGIN_FORBIDDEN' }, origin);
    return true;
  }
  return false;
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_CHARS) throw new Error('REQUEST_TOO_LARGE');
  }
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
}

function replaceTokens(value, values) {
  if (typeof value === 'string') return value.replace(/\{\{(NOVA_PROMPT|NOVA_SECONDS|NOVA_ASPECT_RATIO)\}\}/g, (_, key) => values[key]);
  if (Array.isArray(value)) return value.map(item => replaceTokens(item, values));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, values)]));
  return value;
}

async function loadWorkflow(values) {
  const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));
  return replaceTokens(workflow, values);
}

function completedVideo(history, promptId) {
  const outputs = history?.[promptId]?.outputs;
  if (!outputs || typeof outputs !== 'object') return null;
  for (const node of Object.values(outputs)) {
    for (const key of ['gifs', 'videos', 'images']) {
      const file = node?.[key]?.[0];
      if (file?.filename) return file;
    }
  }
  return null;
}

function safePart(value, allowEmpty = false) {
  return (allowEmpty && value === '') || /^[A-Za-z0-9._-]+$/.test(value);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (cors(req, res)) return;
  const url = new URL(req.url, `http://${req.headers.host || host}`);

  try {
    if (url.pathname === '/health' && req.method === 'GET') {
      return send(res, 200, { app: 'NOVA Local Video Server', api: 'online', engine: 'ComfyUI/Wan2.1' }, origin);
    }

    if (url.pathname === '/api/video' && req.method === 'POST') {
      const input = await body(req);
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res, 400, { error: 'Очікується JSON-об’єкт.', code: 'INVALID_REQUEST' }, origin);
      const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt) return send(res, 400, { error: 'Опиши відео.', code: 'PROMPT_REQUIRED' }, origin);
      if (prompt.length > MAX_PROMPT_CHARS) return send(res, 400, { error: 'Опис має бути не довшим за 1800 символів.', code: 'PROMPT_TOO_LONG' }, origin);
      const seconds = String(Math.max(4, Math.min(12, Number(input.seconds) || 5)));
      const aspectRatio = ['16:9', '9:16', '1:1'].includes(input.aspect_ratio) ? input.aspect_ratio : '16:9';
      const workflow = await loadWorkflow({ NOVA_PROMPT: prompt, NOVA_SECONDS: seconds, NOVA_ASPECT_RATIO: aspectRatio });
      const response = await fetch(`${comfyUrl}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.prompt_id) return send(res, 502, { error: data.error?.message || 'ComfyUI не прийняв завдання.', code: 'COMFYUI_SUBMIT_FAILED' }, origin);
      return send(res, 202, { video_id: data.prompt_id, provider: 'local-comfyui' }, origin);
    }

    if (url.pathname === '/api/video' && req.method === 'GET') {
      const promptId = url.searchParams.get('video_id');
      if (!promptId || promptId.length > 200) return send(res, 400, { error: 'Не вказано коректний video_id.', code: 'VIDEO_ID_REQUIRED' }, origin);
      const response = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`);
      const history = await response.json().catch(() => ({}));
      if (!response.ok) return send(res, 502, { error: 'Не вдалося перевірити статус ComfyUI.', code: 'COMFYUI_STATUS_FAILED' }, origin);
      const file = completedVideo(history, promptId);
      if (!file) return send(res, 200, { status: 'processing' }, origin);
      const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
      return send(res, 200, { status: 'completed', video_url: `http://${host}:${port}/media?${query}` }, origin);
    }

    if (url.pathname === '/media' && req.method === 'GET') {
      const filename = url.searchParams.get('filename') || '';
      const subfolder = url.searchParams.get('subfolder') || '';
      const type = url.searchParams.get('type') || 'output';
      if (!safePart(filename) || !subfolder.split('/').every(part => safePart(part, true)) || !['output', 'temp'].includes(type)) return send(res, 400, { error: 'Некоректний шлях до файлу.', code: 'INVALID_MEDIA_PATH' }, origin);
      const response = await fetch(`${comfyUrl}/view?${new URLSearchParams({ filename, subfolder, type })}`);
      if (!response.ok || !response.body) return send(res, 404, { error: 'Відеофайл не знайдено.', code: 'VIDEO_NOT_FOUND' }, origin);
      const headers = { 'Content-Type': response.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'no-store' };
      if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
      res.writeHead(200, headers);
      for await (const chunk of response.body) res.write(chunk);
      return res.end();
    }

    return send(res, 404, { error: 'Not found.' }, origin);
  } catch (error) {
    const code = error.message === 'REQUEST_TOO_LARGE' || error.message === 'INVALID_JSON' ? error.message : 'LOCAL_VIDEO_SERVER_ERROR';
    const status = code === 'REQUEST_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 502;
    console.error('NOVA Local Video Server:', error);
    return send(res, status, { error: code === 'INVALID_JSON' ? 'Некоректний JSON.' : 'Локальний відеосервер недоступний або не налаштований.', code }, origin);
  }
});

server.listen(port, host, () => console.log(`NOVA Local Video Server: http://${host}:${port}`));
