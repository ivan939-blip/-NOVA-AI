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
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json({ error: 'Повідомлення користувача не знайдено.', code: 'MESSAGE_REQUIRED' }, 400);
  }

  try {
    const result = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 900,
      temperature: 0.7,
      chat_template_kwargs: { enable_thinking: false }
    });

    // Workers AI chat models may return OpenAI-compatible choices or a
    // direct response field depending on the binding/model response shape.
    const rawAnswer = result?.response
      ?? result?.choices?.[0]?.message?.content
      ?? result?.result?.response
      ?? result?.result?.choices?.[0]?.message?.content;
    const answer = Array.isArray(rawAnswer)
      ? rawAnswer.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim()
      : typeof rawAnswer === 'string' ? rawAnswer.trim() : '';

    if (!answer) {
      console.error('NOVA Workers AI returned no text:', JSON.stringify({
        keys: result && typeof result === 'object' ? Object.keys(result) : [],
        finish_reason: result?.choices?.[0]?.finish_reason,
        has_reasoning: Boolean(result?.reasoning || result?.reasoning_content || result?.choices?.[0]?.message?.reasoning_content)
      }));
      return json({
        error: 'Модель не повернула текст. Перевірено стандартний формат Workers AI та формат choices.',
        code: 'AI_EMPTY_RESPONSE',
        diagnostic: {
          responseKeys: result && typeof result === 'object' ? Object.keys(result) : [],
          finishReason: result?.choices?.[0]?.finish_reason || null
        }
      }, 502);
    }
    return json({ answer, diagnostic: { status: 'ok', model: '@cf/zai-org/glm-4.7-flash' } });
  } catch (error) {
    console.error('NOVA Workers AI error:', error);
    return json({
      error: 'Cloudflare Workers AI не зміг виконати запит. Перевір binding AI, доступність моделі та ліміти.',
      code: 'AI_RUN_FAILED',
      diagnostic: { errorName: error?.name || 'UnknownError' }
    }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
