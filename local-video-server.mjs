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
async function render(job, image) {
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

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (allowed(req, res)) return;
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (url.pathname === '/health') return send(res, 200, { app: 'NOVA Local Motion Forge', api: 'online', engine: 'FFmpeg' }, origin);
    if (url.pathname === '/api/video' && req.method === 'POST') {
      const input = await parseBody(req); const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt) return send(res, 400, { error: 'Опиши відео.', code: 'PROMPT_REQUIRED' }, origin);
      if (prompt.length > 1800) return send(res, 400, { error: 'Опис має бути не довшим за 1800 символів.', code: 'PROMPT_TOO_LONG' }, origin);
      if ([...jobs.values()].filter(job => job.status === 'processing').length >= MAX_CONCURRENT_RENDERS) return send(res, 429, { error: 'Локальний рендер зайнятий двома завданнями. Зачекай завершення одного з них.', code: 'RENDER_QUEUE_FULL' }, origin);
      const id = randomUUID(); const job = { id, status: 'processing', seconds: Math.max(4, Math.min(12, Number(input.seconds) || 5)), aspectRatio: ['16:9', '1:1', '9:16'].includes(input.aspect_ratio) ? input.aspect_ratio : '9:16', motion: ['push-in','pan-left','pan-right','drift'].includes(input.motion) ? input.motion : 'push-in' }; jobs.set(id, job);
      render(job, unpackImage(input.image, id)).catch(error => { console.error(error); job.status = 'failed'; job.error = 'Не вдалося зібрати MP4 локально.'; setTimeout(() => jobs.delete(id), RESULT_TTL_MS); });
      return send(res, 202, { video_id: id, provider: 'local-motion-forge' }, origin);
    }
    if (url.pathname === '/api/video' && req.method === 'GET') {
      const job = jobs.get(url.searchParams.get('video_id'));
      if (!job) return send(res, 404, { error: 'Завдання не знайдено.', code: 'VIDEO_JOB_NOT_FOUND' }, origin);
      if (job.status === 'failed') return send(res, 500, { error: job.error, code: 'LOCAL_RENDER_FAILED' }, origin);
      return send(res, 200, job.status === 'completed' ? { status: 'completed', video_url: `http://${host}:${port}/media/${job.file}` } : { status: 'processing' }, origin);
    }
    if (url.pathname.startsWith('/media/') && ['GET', 'HEAD'].includes(req.method)) {
      const name = url.pathname.slice(7);
      if (!/^nova-[a-f0-9-]+\.mp4$/i.test(name)) return send(res, 400, { code: 'INVALID_MEDIA_PATH' }, origin);
      let video;
      try { video = await readFile(resolve(outputDir, name)); } catch (error) { if (error?.code === 'ENOENT') return send(res, 404, { error: 'Відеофайл уже недоступний.', code: 'VIDEO_FILE_NOT_FOUND' }, origin); throw error; }
      const headers = { 'Content-Type': 'video/mp4', 'Content-Length': video.length, 'Cache-Control': 'no-store' };
      if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
      res.writeHead(200, headers); return req.method === 'HEAD' ? res.end() : res.end(video);
    }
    return send(res, 404, { error: 'Not found.' }, origin);
  } catch (error) {
    const code = ['REQUEST_TOO_LARGE', 'INVALID_JSON'].includes(error.message) ? error.message : 'LOCAL_VIDEO_SERVER_ERROR';
    return send(res, code === 'REQUEST_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 502, { error: 'Локальний відеосервер недоступний.', code }, origin);
  }
}).listen(port, host, () => console.log(`NOVA Local Motion Forge: http://${host}:${port}`));
