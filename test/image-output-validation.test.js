import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/image.js';

function requestFor(prompt = 'A violet flower') {
  return new Request('https://nova.example/api/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
}

test('Image Studio returns valid base64 image data from Workers AI', async () => {
  const calls = [];
  const response = await onRequestPost({
    request: requestFor(),
    env: { AI: { run: async (model, input) => {
      calls.push({ model, input });
      return { image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=' };
    } } }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).image, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=');
  assert.equal(calls.length, 1);
});

test('Image Studio preserves valid image data URLs', async () => {
  const response = await onRequestPost({
    request: requestFor(),
    env: { AI: { run: async () => ({ image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=' }) } }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).image, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=');
});

for (const invalid of ['aGVsbG8=', 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'upstream model unavailable', 'data:image/jpeg;base64,not base64!', '', 'data:text/html;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=']) {
  test('Image Studio rejects invalid image output: ' + JSON.stringify(invalid), async () => {
    const response = await onRequestPost({
      request: requestFor(),
      env: { AI: { run: async () => ({ image: invalid }) } }
    });
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.code, 'IMAGE_GENERATION_FAILED');
    assert.equal('image' in payload, false);
  });
}
