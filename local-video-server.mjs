import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const port = Number(process.env.NOVA_VIDEO_PORT || 8189);
const host = '127.0.0.1';
const outputDir = resolve('local-video-output');
const allowedOrigins = new Set((process.env.NOVA_ALLOWED_ORIGINS || 'https://nova-ai-7qd.pages.dev,http://localhost:5173').split(',').map(x => x.trim()));
const jobs = new Map();
const RENDER_TIMEOUT_MS = 120_000;
const RESULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_CONCURRENT_RENDERS = 2;
const comfyUrl = (process.env.NOVA_COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const comfyWorkflowPath = process.env.NOVA_COMFY_WORKFLOW || '';

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers); res.end(JSON.stringify(body));
}
function allowed(req, res) {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    if (!origin || !allowedOrigins.has(origin)) return send(res, 403, { code: 'ORIGIN_FORBIDDEN' }, origin);
    res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return true;
  }
  if (origin && !allowedOrigins.has(origin)) { send(res, 403, { code: 'ORIGIN_FORBIDDEN' }, origin); return true; }
  return false;
}
async function parseBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 12_000_000) throw new Error('REQUEST_TOO_LARGE'); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
}
function execFfmpeg(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true }); let error = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), RENDER_TIMEOUT_MS);
    child.stderr.on('data', chunk => { error += chunk; }); child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      code === 0 ? resolveRun() : reject(new Error(error.slice(-1200) || 'FFmpeg timed out or failed'));
    });
  });
}
function unpackImage(value, id) {
  const match = typeof value === 'string' && value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const data = Buffer.from(match[2], 'base64');
  // Tiny/corrupt placeholders can make FFmpeg scale indefinitely on weak CPUs.
  if (data.length < 1_024) return null;
  return { name: `source-${id}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`, data };
}
async function renderMotion(job, image) {
  await mkdir(outputDir, { recursive: true });
  const target = resolve(outputDir, `nova-${job.id}.mp4`);
  const title = 'NOVA AI // LOCAL MOTION';
  const size = job.aspectRatio === '16:9' ? '854x480' : job.aspectRatio === '1:1' ? '640x640' : '480x854';
  const [width, height] = size.split('x');
  let args;
  if (image) {
    const source = resolve(outputDir, image.name); await writeFile(source, image.data);
    const frames = Math.max(1, job.seconds * 24);
    const motion = job.motion === 'pan-left'
      ? `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':d=1:s=${size}:fps=24`
      : job.motion === 'pan-right'
      ? `zoompan=z='1.12':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':d=1:s=${size}:fps=24`
      : job.motion === 'drift'
      ? `zoompan=z='1.08+0.025*sin(on/18)':x='iw/2-(iw/zoom/2)+10*sin(on/15)':y='ih/2-(ih/zoom/2)+8*cos(on/19)':d=1:s=${size}:fps=24`
      : `zoompan=z='min(zoom+0.00075,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${size}:fps=24`;
    args = ['-y', '-loop', '1', '-i', source, '-f', 'lavfi', '-i', 'sine=frequency=55:sample_rate=44100', '-filter_complex', `[0:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},${motion},eq=contrast=1.08:saturation=1.18,fade=t=in:st=0:d=0.5,drawtext=text='${title}':fontcolor=white@0.8:fontsize=18:x=28:y=h-55[v]`, '-map', '[v]', '-map', '1:a'];
  } else {
    args = ['-y', '-f', 'lavfi', '-i', `color=c=0x10071d:s=${size}:r=24`, '-f', 'lavfi', '-i', 'sine=frequency=55:sample_rate=44100', '-filter_complex', `[0:v]drawgrid=width=56:height=56:thickness=1:color=0x8c4dff@0.13,eq=contrast=1.12:saturation=1.3,drawtext=text='${title}':fontcolor=0xdcc8ff@0.9:fontsize=20:x=28:y=h-55[v]`, '-map', '[v]', '-map', '1:a'];
  }
  args.push('-t', String(job.seconds), '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-af', 'volume=0.035', '-movflags', '+faststart', target);
  try {
    await execFfmpeg(args); job.file = `nova-${job.id}.mp4`; job.status = 'completed';
    setTimeout(() => { jobs.delete(job.id); rm(target, { force: true }).catch(() => {}); }, RESULT_TTL_MS);
  } finally {
    if (image) await rm(resolve(outputDir, image.name), { force: true });
  }
}

function replaceTemplate(value, variables) {
  if (typeof value === 'string') {
    const exact = value.match(/^{{([A-Z_]+)}}$/);
    if (exact && Object.hasOwn(variables, exact[1])) return variables[exact[1]];
    return value.replace(/{{([A-Z_]+)}}/g, (_, name) => String(variables[name] ?? ''));
  }
  if (Array.isArray(value)) return value.map(item => replaceTemplate(item, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTemplate(item, variables)]));
  return value;
}
async function uploadComfyImage(image) {
  if (!image) return '';
  const form = new FormData();
  form.set('image', new Blob([image.data], { type: `image/${image.name.split('.').pop()}` }), image.name);
  const response = await fetch(`${comfyUrl}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ComfyUI image upload failed (${response.status})`);
  const uploaded = await response.json();
  return uploaded.name || image.name;
}
function videoOutput(outputs) {
  for (const output of Object.values(outputs || {})) {
    // ComfyUI output nodes do not use one fixed key: SaveWEBM commonly
    // returns `images`, while video helper nodes use `gifs` or `videos`.
    for (const key of ['gifs', 'videos', 'images']) {
      const item = output?.[key]?.[0];
      if (item?.filename) return item;
    }
  }
  return null;
}
async function renderNeural(job, image) {
  if (!comfyWorkflowPath) throw new Error('NEURAL_BACKEND_NOT_CONFIGURED');
  let template;
  try { template = JSON.parse(await readFile(resolve(comfyWorkflowPath), 'utf8')); } catch { throw new Error('COMFY_WORKFLOW_INVALID'); }
  const sourceName = await uploadComfyImage(image);
  const [width, height] = (job.aspectRatio === '16:9' ? '854x480' : job.aspectRatio === '1:1' ? '640x640' : '480x854').split('x');
  const workflow = replaceTemplate(template, {
    PROMPT: job.prompt, NEGATIVE_PROMPT: 'blurry, low quality, distorted, watermark, text', WIDTH: width, HEIGHT: height,
    FRAMES: job.seconds * 16, STEPS: job.steps, SEED: Math.floor(Math.random() * 2_147_483_647), IMAGE_FILENAME: sourceName
  });
  const queued = await fetch(`${comfyUrl}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: `nova-${job.id}` }), signal: AbortSignal.timeout(30_000) });
  if (!queued.ok) throw new Error(`COMFY_QUEUE_FAILED_${queued.status}`);
  const { prompt_id: promptId } = await queued.json();
  if (!promptId) throw new Error('COMFY_NO_PROMPT_ID');
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 2_000));
    const history = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(20_000) });
    if (!history.ok) continue;
    const item = (await history.json())[promptId];
    if (!item) continue;
    if (item.status?.status_str === 'error') throw new Error('COMFY_RENDER_FAILED');
    const output = videoOutput(item.outputs);
    if (!output) continue;
    const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'output' });
    const media = await fetch(`${comfyUrl}/view?${query}`, { signal: AbortSignal.timeout(120_000) });
    if (!media.ok) throw new Error(`COMFY_DOWNLOAD_FAILED_${media.status}`);
    const extension = /\.webm$/i.test(output.filename) ? '.webm' : '.mp4';
    const target = resolve(outputDir, `nova-${job.id}${extension}`);
    await mkdir(outputDir, { recursive: true }); await writeFile(target, Buffer.from(await media.arrayBuffer()));
    job.file = `nova-${job.id}${extension}`; job.status = 'completed';
    setTimeout(() => { jobs.delete(job.id); rm(target, { force: true }).catch(() => {}); }, RESULT_TTL_MS);
    return;
  }
  throw new Error('COMFY_RENDER_TIMEOUT');
}

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (allowed(req, res)) return;
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (url.pathname === '/health') return send(res, 200, { app: 'NOVA Local Video', api: 'online', engine: 'FFmpeg', neural: Boolean(comfyWorkflowPath), neuralEngine: comfyWorkflowPath ? 'ComfyUI workflow' : 'not configured' }, origin);
    if (url.pathname === '/api/video' && req.method === 'POST') {
      const input = await parseBody(req); const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt) return send(res, 400, { error: 'Опиши відео.', code: 'PROMPT_REQUIRED' }, origin);
      if (prompt.length > 1800) return send(res, 400, { error: 'Опис має бути не довшим за 1800 символів.', code: 'PROMPT_TOO_LONG' }, origin);
      if ([...jobs.values()].filter(job => job.status === 'processing').length >= MAX_CONCURRENT_RENDERS) return send(res, 429, { error: 'Локальний рендер зайнятий двома завданнями. Зачекай завершення одного з них.', code: 'RENDER_QUEUE_FULL' }, origin);
      const engine = input.engine === 'motion' ? 'motion' : 'neural';
      if (engine === 'neural' && !comfyWorkflowPath) return send(res, 503, { error: 'Нейромережевий режим потребує локального ComfyUI та NOVA_COMFY_WORKFLOW. Обери Motion Forge або налаштуй безкоштовний локальний бекенд.', code: 'NEURAL_BACKEND_NOT_CONFIGURED' }, origin);
      const id = randomUUID(); const job = { id, status: 'processing', engine, prompt, seconds: Math.max(4, Math.min(12, Number(input.seconds) || 5)), steps: Math.max(4, Math.min(24, Number(input.steps) || 24)), aspectRatio: ['16:9', '1:1', '9:16'].includes(input.aspect_ratio) ? input.aspect_ratio : '9:16', motion: ['push-in','pan-left','pan-right','drift'].includes(input.motion) ? input.motion : 'push-in' }; jobs.set(id, job);
      const image = unpackImage(input.image, id);
      (engine === 'neural' ? renderNeural(job, image) : renderMotion(job, image)).catch(error => { console.error(error); job.status = 'failed'; job.error = error.message === 'NEURAL_BACKEND_NOT_CONFIGURED' ? 'Нейромережевий бекенд не налаштований.' : engine === 'neural' ? 'ComfyUI не створив відео. Перевір запущений сервер і workflow.' : 'Не вдалося зібрати MP4 локально.'; setTimeout(() => jobs.delete(id), RESULT_TTL_MS); });
      return send(res, 202, { video_id: id, provider: engine === 'neural' ? 'local-comfyui-neural' : 'local-motion-forge' }, origin);
    }
    if (url.pathname === '/api/video' && req.method === 'GET') {
      const job = jobs.get(url.searchParams.get('video_id'));
      if (!job) return send(res, 404, { error: 'Завдання не знайдено.', code: 'VIDEO_JOB_NOT_FOUND' }, origin);
      if (job.status === 'failed') return send(res, 500, { error: job.error, code: 'LOCAL_RENDER_FAILED' }, origin);
      return send(res, 200, job.status === 'completed' ? { status: 'completed', video_url: `http://${host}:${port}/media/${job.file}` } : { status: 'processing' }, origin);
    }
    if (url.pathname.startsWith('/media/') && ['GET', 'HEAD'].includes(req.method)) {
      const name = url.pathname.slice(7);
      if (!/^nova-[a-f0-9-]+\.(mp4|webm)$/i.test(name)) return send(res, 400, { code: 'INVALID_MEDIA_PATH' }, origin);
      let video;
      try { video = await readFile(resolve(outputDir, name)); } catch (error) { if (error?.code === 'ENOENT') return send(res, 404, { error: 'Відеофайл уже недоступний.', code: 'VIDEO_FILE_NOT_FOUND' }, origin); throw error; }
      const headers = { 'Content-Type': name.endsWith('.webm') ? 'video/webm' : 'video/mp4', 'Content-Length': video.length, 'Cache-Control': 'no-store' };
      if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
      res.writeHead(200, headers); return req.method === 'HEAD' ? res.end() : res.end(video);
    }
    return send(res, 404, { error: 'Not found.' }, origin);
  } catch (error) {
    const code = ['REQUEST_TOO_LARGE', 'INVALID_JSON'].includes(error.message) ? error.message : 'LOCAL_VIDEO_SERVER_ERROR';
    return send(res, code === 'REQUEST_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 502, { error: 'Локальний відеосервер недоступний.', code }, origin);
  }
}).listen(port, host, () => console.log(`NOVA Local Video: http://${host}:${port}`));
