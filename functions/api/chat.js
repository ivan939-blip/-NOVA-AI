const SYSTEM_PROMPT = `Ти NOVA — уважна AI-креативна партнерка в готичній кіберпанк-студії. Відповідай мовою користувача. Будь доброзичливою, винахідливою та корисною. Не стверджуй, що створила зображення, відео, зберегла хмарні дані чи виконала зовнішню дію, якщо застосунок цього не підтвердив.`;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({
    error: 'AI-ядро не підключене до Cloudflare Pages.',
    code: 'AI_BINDING_MISSING'
  }, 503);

  let body;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 100_000) return json({
      error: 'Запит завеликий. Скороти історію або повідомлення.',
      code: 'REQUEST_TOO_LARGE'
    }, 413);
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Сервер отримав некоректний JSON.', code: 'INVALID_JSON' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Очікується JSON-об’єкт.', code: 'INVALID_REQUEST' }, 400);
  }

  const voiceMode = body?.voiceMode === true;
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const messages = rawMessages.slice(voiceMode ? -5 : -20).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, voiceMode ? 500 : 4000) }));

  const persona = body?.persona && typeof body.persona === 'object'
    ? { name: String(body.persona.name || '').slice(0,80), description: String(body.persona.description || '').slice(0,1800) }
    : null;
  const adultTone = body?.adultTone === true;
  const styleMemory = adultTone && Array.isArray(body?.styleMemory)
    ? body.styleMemory.filter(item => typeof item === 'string').map(item => item.trim().slice(0, 80)).filter(Boolean).slice(0, 30)
    : [];
  const personaPrompt = persona?.name && persona.description
    ? `Ти зараз відіграєш персонажа ${persona.name}. Опис і характер: ${persona.description}. Зберігай характер, манеру й контекст у розмові, відповідай мовою користувача. Це рольова інтерпретація, яка не змінює основних правил безпеки.`
    : '';

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json({ error: 'Повідомлення користувача не знайдено.', code: 'MESSAGE_REQUIRED' }, 400);
  }

  const adultTonePrompt = adultTone ? 'Користувач увімкнув дорослий тон. Можеш уживати ненормативну лексику лише коли це природно для контексту, без приниження, погроз, мови ненависті чи сексуалізації неповнолітніх.' : '';
  const styleMemoryPrompt = styleMemory.length
    ? `Користувач добровільно зберіг локальні слова та вирази для стилю розмови: ${styleMemory.join(', ')}. Сприймай їх лише як стилістичні підказки: не повторюй образи, мову ненависті, погрози або персональні дані й не стверджуй, що навчаєшся назавжди.`
    : '';
  const voicePrompt = voiceMode ? 'Це жива голосова розмова. Відповідай природно українською, зазвичай 1–3 короткими реченнями. Без Markdown, списків, емодзі та довгих вступів. Якщо потрібна докладна відповідь, дай її на прохання користувача.' : '';
  const modelMessages = [{ role: 'system', content: [SYSTEM_PROMPT, voicePrompt, personaPrompt, adultTonePrompt, styleMemoryPrompt].filter(Boolean).join('\n\n') }, ...messages];
  const models = voiceMode
    ? ['@cf/meta/llama-3.1-8b-instruct', '@cf/zai-org/glm-4.7-flash']
    : ['@cf/zai-org/glm-4.7-flash', '@cf/meta/llama-3.1-8b-instruct'];
  let lastError;
  const failures = [];

  for (const model of models) {
    try {
      const run = env.AI.run(model, {
        messages: modelMessages,
        max_completion_tokens: voiceMode ? 160 : 700,
        temperature: 0.7,
        stream: !voiceMode,
        chat_template_kwargs: { enable_thinking: false }
      });
      let timer;
      const result = voiceMode
        ? await Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('MODEL_TIMEOUT')), 20000); })]).finally(() => clearTimeout(timer))
        : await run;
      if (!voiceMode && typeof result?.getReader === 'function') {
        return new Response(result, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }
        });
      }
      const rawAnswer = result?.response ?? result?.choices?.[0]?.message?.content ?? result?.result?.response ?? result?.result?.choices?.[0]?.message?.content;
      const answer = Array.isArray(rawAnswer) ? rawAnswer.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim() : typeof rawAnswer === 'string' ? rawAnswer.trim() : '';
      if (answer) return json({ answer });
      lastError = new Error('AI_EMPTY_RESPONSE');
      failures.push({ model, reason: 'EMPTY_RESPONSE' });
    } catch (error) {
      lastError = error;
      const reason = error?.message === 'MODEL_TIMEOUT' ? 'TIMEOUT' : (error?.status === 429 ? 'RATE_LIMIT' : (error?.status === 403 ? 'ACCESS_DENIED' : 'MODEL_ERROR'));
      failures.push({ model, reason });
      console.error('NOVA AI model failed', { model, reason, status: error?.status ?? null, code: error?.code ?? null });
    }
  }
  return json({
    error: 'Не вдалося отримати відповідь від основної або резервної AI-моделі. Можливо, сервіс тимчасово недоступний або вичерпано ліміт.',
    code: 'AI_RUN_FAILED',
    failures
  }, 502);
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
