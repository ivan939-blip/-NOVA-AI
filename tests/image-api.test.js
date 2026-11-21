import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequest } from '../functions/api/image.js';

const makeRequest = (body) => new Request('https://nova.test/api/image', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body
});
const post = (body, env = {}) => onRequestPost({ request: makeRequest(body), env });

test('returns 503 if Workers AI binding is missing', async () => {
  const res = await post(JSON.stringify({ prompt: 'moonlit castle' }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'AI_BINDING_MISSING');
});

test('rejects malformed JSON', async () => {
  const res = await post('{');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_JSON');
});

test('rejects a non-object payload', async () => {
  const res = await post(JSON.stringify(['prompt']));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'INVALID_REQUEST');
});

test('rejects empty prompts', async () => {
  const res = await post(JSON.stringify({ prompt: '   ' }), { AI: { run: async () => ({ image: 'x' }) } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'PROMPT_REQUIRED');
});

test('rejects oversized requests before invoking AI', async () => {
  let invoked = false;
  const res = await post(JSON.stringify({ prompt: 'x'.repeat(1_500_001) }), { AI: { run: async () => { invoked = true; } } });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, 'REQUEST_TOO_LARGE');
  assert.equal(invoked, false);
});

test('rejects prompts over the allowed limit', async () => {
  let invoked = false;
  const res = await post(JSON.stringify({ prompt: 'x'.repeat(1801) }), { AI: { run: async () => { invoked = true; } } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'PROMPT_TOO_LONG');
  assert.equal(invoked, false);
});

test('returns base64 image data from FLUX with a reproducible seed', async () => {
  const res = await post(JSON.stringify({ prompt: 'moonlit castle', seed: 12345 }), {
    AI: { run: async (model, options) => {
      assert.equal(model, '@cf/black-forest-labs/flux-1-schnell');
      assert.equal(options.steps, 4);
      assert.equal(options.seed, 12345);
      assert.match(options.prompt, /Follow every explicit detail/);
      return { image: 'YWJj' };
    } }
  });
  assert.equal(res.status, 200);
  const body=await res.json(); assert.equal(body.image, 'data:image/jpeg;base64,YWJj'); assert.equal(body.seed,12345); assert.equal(body.strictPromptApplied,true);
});

test('falls back to image generation without seed only when the provider rejects seed', async () => {
  let calls=0;
  const res=await post(JSON.stringify({prompt:'moon',seed:42}),{AI:{run:async (_model,options)=>{calls++;if(options.seed)throw new Error('seed validation failed');assert.equal(options.seed,undefined);return {image:'YWJj'};}}});
  const body=await res.json(); assert.equal(res.status,200); assert.equal(calls,2); assert.equal(body.seedApplied,false);
});

test('uses FLUX reference model for a valid uploaded image', async () => {
  const res = await post(JSON.stringify({ prompt: 'turn image 0 into a violet portrait', referenceImage: 'data:image/jpeg;base64,YWJj', presentation:'feminine', preserveFace:true }), {
    AI: { run: async (model, options) => { assert.equal(model, '@cf/black-forest-labs/flux-2-klein-4b'); assert.ok(options.multipart.body); assert.match(options.multipart.contentType, /multipart\/form-data/); const form=await new Response(options.multipart.body,{headers:{'content-type':options.multipart.contentType}}).formData(); assert.match(form.get('prompt'),/same person/); assert.match(form.get('prompt'),/feminine presentation/); assert.equal(form.get('guidance'),'5'); assert.match(form.get('seed'),/^\d+$/); return { image: 'YWJj' }; } }
  });
  const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.referenceUsed, true); assert.equal(body.presentationApplied,'feminine'); assert.equal(body.preserveFaceApplied,true); assert.equal(body.image, 'data:image/jpeg;base64,YWJj');
});

test('rejects unsafe reference formats before invoking AI', async () => {
  let invoked=false; const res=await post(JSON.stringify({prompt:'moon',referenceImage:'data:image/gif;base64,YWJj'}),{AI:{run:async()=>{invoked=true;}}});
  assert.equal(res.status,400); assert.equal((await res.json()).code,'INVALID_REFERENCE_IMAGE'); assert.equal(invoked,false);
});

test('requires 18+ mode for adult prompts and blocks minor or reference misuse', async () => {
  const env={AI:{run:async()=>({image:'YWJj'})}};
  const required=await post(JSON.stringify({prompt:'erotic portrait'}),env);
  assert.equal(required.status,403); assert.equal((await required.json()).code,'ADULT_MODE_REQUIRED');
  const minor=await post(JSON.stringify({prompt:'nude teenager',adultMode:true}),env);
  assert.equal(minor.status,400); assert.equal((await minor.json()).code,'MINORS_NOT_ALLOWED');
  const reference=await post(JSON.stringify({prompt:'erotic portrait',adultMode:true,referenceImage:'data:image/jpeg;base64,YWJj'}),env);
  assert.equal(reference.status,400); assert.equal((await reference.json()).code,'ADULT_REFERENCE_NOT_ALLOWED');
  const ukrainianAdult=await post(JSON.stringify({prompt:'еротичний портрет'}),env);
  assert.equal(ukrainianAdult.status,403); assert.equal((await ukrainianAdult.json()).code,'ADULT_MODE_REQUIRED');
  const ukrainianMinor=await post(JSON.stringify({prompt:'оголений неповнолітній персонаж',adultMode:true}),env);
  assert.equal(ukrainianMinor.status,400); assert.equal((await ukrainianMinor.json()).code,'MINORS_NOT_ALLOWED');
});

test('converts binary image output to base64', async () => {
  const res = await post(JSON.stringify({ prompt: 'moonlit castle' }), {
    AI: { run: async () => new Uint8Array([97, 98, 99]) }
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).image, 'data:image/png;base64,YWJj');
});

test('converts stream image output to base64', async () => {
  const res = await post(JSON.stringify({ prompt: 'moonlit castle' }), {
    AI: { run: async () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([97, 98, 99])); controller.close(); } }) }
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).image, 'data:image/png;base64,YWJj');
});

test('returns a safe 502 if model fails or output is unsupported', async () => {
  const res = await post(JSON.stringify({ prompt: 'moonlit castle' }), { AI: { run: async () => { throw new Error('secret diagnostic'); } } });
  assert.equal(res.status, 502);
  const failed = await res.json();
  assert.equal(failed.code, 'IMAGE_GENERATION_FAILED');
  assert.doesNotMatch(JSON.stringify(failed), /secret diagnostic/);
  const unsupported = await post(JSON.stringify({ prompt: 'moonlit castle' }), { AI: { run: async () => ({ other: true }) } });
  assert.equal(unsupported.status, 502);
});

test('handles OPTIONS and rejects other methods', async () => {
  const options = await onRequest({ request: new Request('https://nova.test/api/image', { method: 'OPTIONS' }) });
  assert.equal(options.status, 204);
  const get = await onRequest({ request: new Request('https://nova.test/api/image') });
  assert.equal(get.status, 405);
});
