const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: 'AI-ядро не підключене.', code: 'AI_BINDING_MISSING' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Некоректний JSON.', code: 'INVALID_JSON' }, 400); }
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim().slice(0, 1800) : '';
  if (!prompt) return json({ error: 'Напиши опис зображення.', code: 'PROMPT_REQUIRED' }, 400);
  try {
    const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 });
    const bytes = result instanceof ReadableStream ? await new Response(result).arrayBuffer() : result?.image ? result.image : result;
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('Image model returned no image bytes');
    const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let binary=''; const chunkSize=0x8000;
    for(let i=0;i<data.length;i+=chunkSize) binary+=String.fromCharCode(...data.subarray(i,i+chunkSize));
    return json({ image: 'data:image/png;base64,' + btoa(binary) });
  } catch(error) {
    console.error('NOVA image generation failed:',error);
    return json({ error: 'Не вдалося створити зображення. Перевір ліміти Workers AI та доступність моделі.', code: 'IMAGE_GENERATION_FAILED', diagnostic: String(error?.message||error).slice(0,180) }, 502);
  }
}
export async function onRequest({ request }) { if(request.method==='OPTIONS') return new Response(null,{status:204}); return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}}); }
