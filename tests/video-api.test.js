import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/video.js';

const request = (url, options) => new Request(url, options);
test('keeps the Cloudflare endpoint free and reports an unconfigured companion safely', async () => {
  const res = await onRequest({ request: request('https://nova.test/api/video'), env: {} });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'VIDEO_BACKEND_UNAVAILABLE');
  assert.match(body.error, /нейровідеосервер/i);
});

test('reports an expired or unavailable tunnel without hiding the cause as invalid JSON', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>tunnel unavailable</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  try {
    const res = await onRequest({ request: request('https://nova.test/api/video?video_id=probe'), env: { NOVA_VIDEO_BACKEND_URL: 'https://companion.test', NOVA_VIDEO_BACKEND_TOKEN: 'secret' } });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, 'VIDEO_BACKEND_TUNNEL_UNAVAILABLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
