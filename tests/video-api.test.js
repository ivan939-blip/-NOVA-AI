import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/video.js';

const request = (url, options) => new Request(url, options);
const configured = { AGNES_API_KEY: 'test-key' };

test('reports an unconfigured video provider without exposing secret configuration', async () => {
  const res = await onRequest({ request: request('https://nova.test/api/video'), env: {} });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'VIDEO_PROVIDER_NOT_CONFIGURED');
});

test('validates POST bodies before calling the provider', async () => {
  const malformed = await onRequest({ request: request('https://nova.test/api/video', { method: 'POST', body: '{' }), env: configured });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'INVALID_JSON');

  const empty = await onRequest({ request: request('https://nova.test/api/video', { method: 'POST', body: JSON.stringify({ prompt: ' ' }) }), env: configured });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, 'PROMPT_REQUIRED');
});

test('forwards a valid video request with normalized options', async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, options };
    return new Response(JSON.stringify({ video_id: 'job-1' }), { status: 200 });
  };
  try {
    const res = await onRequest({ request: request('https://nova.test/api/video', { method: 'POST', body: JSON.stringify({ prompt: 'neon rain', seconds: 99, aspect_ratio: 'invalid' }) }), env: configured });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { video_id: 'job-1' });
    assert.equal(sent.url, 'https://apihub.agnes-ai.com/v1/videos');
    assert.deepEqual(JSON.parse(sent.options.body), { model: 'agnes-video-2.5-flash', prompt: 'neon rain', mode: 'text', seconds: '12', size: '720P', aspect_ratio: '16:9' });
  } finally { globalThis.fetch = originalFetch; }
});

test('handles provider failures and unsupported methods safely', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('temporary outage', { status: 502 });
  try {
    const failed = await onRequest({ request: request('https://nova.test/api/video?video_id=job-1'), env: configured });
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).code, 'VIDEO_STATUS_FAILED');
  } finally { globalThis.fetch = originalFetch; }

  const options = await onRequest({ request: request('https://nova.test/api/video', { method: 'OPTIONS' }), env: configured });
  assert.equal(options.status, 204);
  const rejected = await onRequest({ request: request('https://nova.test/api/video', { method: 'PUT' }), env: configured });
  assert.equal(rejected.status, 405);
});
