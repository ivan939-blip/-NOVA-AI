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
