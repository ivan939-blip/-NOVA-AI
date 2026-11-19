const SYSTEM_PROMPT = `Ти NOVA — уважна AI-креативна партнерка в готичній кіберпанк-студії. Відповідай мовою користувача. Будь доброзичливою, винахідливою та корисною. Не стверджуй, що створила зображення, відео, зберегла хмарні дані чи виконала зовнішню дію, якщо застосунок цього не підтвердив.`;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: 'AI binding is not configured.' }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string')
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4000) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json({ error: 'A user message is required.' }, 400);
  }

  try {
    const result = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 700,
      temperature: 0.7
    });
    const answer = result?.response?.trim();
    if (!answer) return json({ error: 'NOVA returned an empty response.' }, 502);
    return json({ answer });
  } catch (error) {
    console.error('NOVA Workers AI error:', error);
    return json({ error: 'NOVA is temporarily unavailable. Check the Workers AI binding and free quota.' }, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
