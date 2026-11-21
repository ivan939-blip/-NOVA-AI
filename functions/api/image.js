const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_BODY_CHARS = 1_500_000;
const MAX_PROMPT_CHARS = 1_800;
const MAX_REFERENCE_BYTES = 1_000_000;
// JavaScript's \b is ASCII-oriented and does not reliably recognize Ukrainian word
// boundaries. Match stems directly so the same policy applies in every supported language.
const ADULT_TERMS = /(erotic|erotica|nude|nudity|naked|explicit|sex(?:ual)?|porn|nsfw|оголен|еротич|інтим|секс|порно)/iu;
const PROHIBITED_ADULT_TERMS = /(minor|child|teen(?:ager)?|underage|schoolgirl|schoolboy|loli|неповноліт|дитин|підлітк|школяр)/iu;
const MAX_SEED = 4_294_967_295;
const STRICT_PROMPT_SUFFIX = 'Follow every explicit detail in the request exactly: subject, attributes, count, composition, colors, clothing and scene. Do not add people, text, logos, objects or style elements not requested. If a detail is unspecified, keep it simple and unobtrusive.';
const NOVA_AURAS = {
  violet: 'violet neon aura, deep black shadows, luminous purple highlights',
  moonlit: 'moonlit nocturne, silver-violet glow, dark romantic atmosphere',
  cyber: 'electric neon cyberpunk aura, rain-slick reflections, magenta and ultraviolet light',
  ember: 'dark ember glow, crimson-violet contrast, cinematic smoke'
};
const NOVA_FOCUS = {
  portrait: 'a deliberate intimate portrait composition with expressive eyes and a clean background',
  fullbody: 'a full-length character composition with a clear, elegant silhouette',
  world: 'an expansive environmental composition where the world is as important as the subject'
};

function requestsAdultContent(prompt) {
  // “non-explicit” describes a safe image and must not be mistaken for a request
  // for explicit content. Other adult terms (for example “nude”) are retained.
  return ADULT_TERMS.test(prompt.replace(/\bnon[-\s]?explicit\b/giu, ''));
}

function validSeed(value) {
  const seed = Number(value);
  return Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED ? seed : Math.floor(Math.random() * MAX_SEED) + 1;
}

function imageDataUrl(result) {
  const encodedImage = typeof result?.image === 'string' ? result.image : typeof result === 'string' ? result : null;
  if (encodedImage) return encodedImage.startsWith('data:image/') ? encodedImage : 'data:image/jpeg;base64,' + encodedImage;
  return null;
}
async function outputDataUrl(result) {
  const direct = imageDataUrl(result); if (direct) return direct;
  const payload = result?.image ?? result;
  const bytes = payload instanceof ReadableStream ? await new Response(payload).arrayBuffer() : payload;
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new Error('Unsupported image output');
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!data.length) throw new Error('Empty image output');
  let binary = ''; for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(binary);
}
function decodeReference(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) return null;
  const binary = atob(match[2]); if (binary.length > MAX_REFERENCE_BYTES) throw new Error('REFERENCE_TOO_LARGE');
  const bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return { type: match[1], bytes };
}

export async function onRequestPost({ request, env }) {
  let rawBody;
  let body;
  try {
    rawBody = await request.text();
    if (rawBody.length > MAX_BODY_CHARS) return json({ error: 'Запит завеликий.', code: 'REQUEST_TOO_LARGE' }, 413);
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Некоректний JSON.', code: 'INVALID_JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Очікується JSON-об’єкт.', code: 'INVALID_REQUEST' }, 400);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return json({ error: 'Напиши опис зображення.', code: 'PROMPT_REQUIRED' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Опис має бути не довшим за 1800 символів.', code: 'PROMPT_TOO_LONG' }, 400);
  let reference;
  try { reference = body.referenceImage === undefined ? null : decodeReference(body.referenceImage); } catch { return json({ error:'Референс-зображення завелике. Обери фото до 5 МБ — NOVA стисне його автоматично.', code:'REFERENCE_TOO_LARGE' },413); }
  if (body.referenceImage !== undefined && !reference) return json({ error:'Референсом може бути лише JPEG, PNG або WebP.', code:'INVALID_REFERENCE_IMAGE' },400);
  const adultMode = body.adultMode === true;
  const requestedAdultContent = requestsAdultContent(prompt);
  if (PROHIBITED_ADULT_TERMS.test(prompt)) return json({ error:'NOVA не створює сексуалізований контент за участі неповнолітніх.', code:'MINORS_NOT_ALLOWED' },400);
  if (requestedAdultContent && !adultMode) return json({ error:'Для повнолітнього контенту спершу ввімкни 18+ Mode.', code:'ADULT_MODE_REQUIRED' },403);
  if (adultMode && reference) return json({ error:'Для приватної 18+ генерації не можна використовувати фото-референси реальних людей.', code:'ADULT_REFERENCE_NOT_ALLOWED' },400);
  const presentation = ['feminine','masculine','unspecified'].includes(body.presentation) ? body.presentation : 'unspecified';
  const adultModel = ['feminine', 'masculine', 'androgynous', 'unspecified'].includes(body.adultModel) ? body.adultModel : 'unspecified';
  const adultStyle = ['photorealistic', 'cinematic', 'gothic'].includes(body.adultStyle) ? body.adultStyle : 'photorealistic';
  const novaAura = NOVA_AURAS[body.novaAura] ? body.novaAura : 'violet';
  const novaFocus = NOVA_FOCUS[body.novaFocus] ? body.novaFocus : 'portrait';
  const preserveFace = body.preserveFace === true;
  const strictPrompt = body.strictPrompt !== false;
  const seed = validSeed(body.seed);
  if (!env.AI) return json({ error: 'AI-ядро не підключене.', code: 'AI_BINDING_MISSING' }, 503);
  try {
    let result; let seedApplied = true;
    if (reference) {
      const presentationInstruction = presentation === 'feminine' ? 'Use a feminine presentation for the person.' : presentation === 'masculine' ? 'Use a masculine presentation for the person.' : '';
      const identityInstruction = preserveFace ? 'Treat image 0 as the same person. Preserve their key facial characteristics, face shape, and identity while changing only the requested scene, styling, lighting, or clothing. Do not replace the person with a different face.' : '';
      const modelPrompt = [prompt, strictPrompt ? STRICT_PROMPT_SUFFIX : '', identityInstruction, presentationInstruction].filter(Boolean).join('\n\n');
      const form = new FormData(); form.append('prompt', modelPrompt); form.append('seed',String(seed)); form.append('guidance','5'); form.append('input_image_0', new Blob([reference.bytes], {type:reference.type}), 'reference-image');
      const request = new Request('https://nova.local/image-reference', {method:'POST',body:form});
      result = await env.AI.run('@cf/black-forest-labs/flux-2-klein-4b', { multipart:{body:request.body,contentType:request.headers.get('content-type')} });
    } else {
      const adultInstruction = adultMode
        ? `${requestedAdultContent ? 'Depict exactly one original, fictional, consenting adult age 25 or older' : 'Depict exactly one original, fictional model character age 25 or older'}${adultModel === 'unspecified' ? ' with the presentation requested by the user' : ` with a ${adultModel} presentation`}. Use a ${adultStyle === 'photorealistic' ? 'photorealistic high-end editorial fashion photography' : adultStyle === 'cinematic' ? 'photorealistic cinematic editorial photography' : 'photorealistic dark gothic editorial photography'} aesthetic. Never depict a real person or a minor.`
        : '';
      const novaDirection = `NOVA Director: ${NOVA_AURAS[novaAura]}; ${NOVA_FOCUS[novaFocus]}.`;
      const modelPrompt = [adultInstruction, novaDirection, prompt, strictPrompt ? STRICT_PROMPT_SUFFIX : ''].filter(Boolean).join('\n\n');
      // FLUX.1 Schnell's published input schema accepts prompt and steps only.
      // Keep the UI seed as metadata, but do not send unsupported seed to the model.
      result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
        prompt: modelPrompt.slice(0, 2048),
        steps: 4
      });
      seedApplied = false;
    }
    return json({
      image: await outputDataUrl(result),
      referenceUsed: Boolean(reference),
      seed,
      seedApplied,
      strictPromptApplied: strictPrompt,
      // Echo only the server-validated options; this is never inferred from the photo.
      presentationApplied: reference ? presentation : null,
      preserveFaceApplied: Boolean(reference && preserveFace)
    });
  } catch (error) {
    // Do not write provider exception text to logs or return it to the client:
    // it can contain request metadata or internal provider details.
    console.error('NOVA image generation failed');
    const detail = String(error?.message || 'Unknown Workers AI error');
    const quotaOrAccess = /quota|limit|neuron|billing|account|not enabled|not available|rate.limit/i.test(detail);
    const modelUnavailable = /no such model|model not found|unknown model|model does not exist|not supported|model_error/i.test(detail);
    const invalidPayload = /invalid|schema|validation|parameter|input|seed/i.test(detail);
    const failureCode = quotaOrAccess ? 'IMAGE_QUOTA_OR_ACCESS' : modelUnavailable ? 'IMAGE_MODEL_UNAVAILABLE' : invalidPayload ? 'IMAGE_MODEL_INPUT_REJECTED' : 'IMAGE_GENERATION_FAILED';
    return json({
      error: reference
        ? 'Не вдалося обробити фото-референс у Workers AI. Спробуй інше зображення або повтори пізніше.'
        : quotaOrAccess
        ? 'Генерація зображень недоступна для цього Workers AI акаунта або вичерпано його ліміт.'
        : requestedAdultContent
        ? 'Поточна Workers AI модель відхилила цей дорослий опис. Спробуй неявний fashion або художній портрет повнолітнього вигаданого персонажа.'
        : modelUnavailable
        ? 'Модель генерації зараз недоступна у Workers AI. Перевір її доступність у Cloudflare.'
        : invalidPayload
        ? 'Workers AI відхилив параметри генерації. Спробуй ще раз без фото.'
        : 'Workers AI не створив зображення. Спробуй пізніше або перевір журнал помилок Cloudflare.',
      code: reference ? 'IMAGE_REFERENCE_GENERATION_FAILED' : requestedAdultContent && !quotaOrAccess && !modelUnavailable ? 'ADULT_CONTENT_RESTRICTED' : failureCode
    }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
