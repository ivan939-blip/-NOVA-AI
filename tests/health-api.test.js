import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/health.js';

test('reports API and Workers AI binding status', async () => {
  const online = await onRequest({ env: { AI: {} } });
  assert.equal(online.status, 200);
  assert.deepEqual(await online.json(), { app: 'NOVA AI', api: 'online', ai: true, provider: 'Cloudflare Workers AI' });

  const withoutBinding = await onRequest({ env: {} });
  assert.equal((await withoutBinding.json()).ai, false);
});
