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
    body = await request.json();
  } catch {
    return json({ error: 'Сервер отримав некоректний JSON.', code: 'INVALID_JSON' }, 400);
  }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string')
    .slice(-12)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 2500) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json({ error: 'Повідомлення користувача не знайдено.', code: 'MESSAGE_REQUIRED' }, 400);
  }

  try {
    // Stream tokens as soon as the model produces them instead of waiting
    // for the entire completion to finish.
    const stream = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_completion_tokens: 700,
      temperature: 0.7,
      stream: true,
      chat_template_kwargs: { enable_thinking: false }
    }, { rejectIfBusy: true });

    if (typeof stream?.getReader !== 'function') {
      const rawAnswer = stream?.response
        ?? stream?.choices?.[0]?.message?.content
        ?? stream?.result?.response
        ?? stream?.result?.choices?.[0]?.message?.content;
      const answer = Array.isArray(rawAnswer)
        ? rawAnswer.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim()
        : typeof rawAnswer === 'string' ? rawAnswer.trim() : '';
      if (!answer) return json({
        error: 'Модель не повернула текстову відповідь.',
        code: 'AI_EMPTY_RESPONSE',
        diagnostic: { responseKeys: stream && typeof stream === 'object' ? Object.keys(stream) : [] }
      }, 502);
      return json({ answer });
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      }
    });
  } catch (error) {
    console.error('NOVA Workers AI error:', error);
    return json({
      error: 'Cloudflare Workers AI не зміг виконати запит. Перевір доступність моделі та ліміти.',
      code: 'AI_RUN_FAILED',
      diagnostic: { errorName: error?.name || 'UnknownError', errorMessage: String(error?.message || '').slice(0, 240) }
    }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
