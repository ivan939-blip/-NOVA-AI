import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, onRequestPost } from '../functions/api/chat.js';

const request = (body, method = 'POST') => new Request('https://nova.test/api/chat', { method, body });

test('returns clear validation errors before calling Workers AI', async () => {
  const missingBinding = await onRequestPost({ request: request(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })), env: {} });
  assert.equal(missingBinding.status, 503);
  assert.equal((await missingBinding.json()).code, 'AI_BINDING_MISSING');

  const invalid = await onRequestPost({ request: request('{'), env: { AI: {} } });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_JSON');

  const noUserMessage = await onRequestPost({ request: request(JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] })), env: { AI: {} } });
  assert.equal(noUserMessage.status, 400);
  assert.equal((await noUserMessage.json()).code, 'MESSAGE_REQUIRED');
});

test('returns a non-streaming Workers AI response', async () => {
  const res = await onRequestPost({
    request: request(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })),
    env: { AI: { run: async (_model, options) => {
      assert.equal(options.stream, true);
      assert.equal(options.messages.at(-1).content, 'hello');
      return { response: 'Привіт' };
    } } }
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { answer: 'Привіт' });
});

test('adds the adult tone instruction only when explicitly enabled', async () => {
  const res = await onRequestPost({
    request: request(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], adultTone: true })),
    env: { AI: { run: async (_model, options) => { assert.match(options.messages[0].content, /дорослий тон/); return { response: 'ok' }; } } }
  });
  assert.equal(res.status, 200);
});

test('passes through a streaming Workers AI response', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: test\n\n')); controller.close(); } });
  const res = await onRequestPost({
    request: request(JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })),
    env: { AI: { run: async () => stream } }
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(await res.text(), 'data: test\n\n');
});

test('handles OPTIONS and rejects unsupported methods', async () => {
  const options = await onRequest({ request: request(null, 'OPTIONS') });
  assert.equal(options.status, 204);
  const get = await onRequest({ request: request(null, 'GET') });
  assert.equal(get.status, 405);
});
