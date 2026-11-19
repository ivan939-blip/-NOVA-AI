const NOVA_SYSTEM_PROMPT = `You are NOVA, a thoughtful AI creative partner inside a gothic cyberpunk studio. Reply in the user's language. Be concise, imaginative, and helpful. You must never claim to have generated an image, video, saved cloud data, or performed an external action unless the application has confirmed it.`;

function textFromResponse(response) {
  if (response.output_text) return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text')
    .map((content) => content.text)
    .join('');
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });
  if (!process.env.OPENAI_API_KEY) {
    return response.status(503).json({ error: 'AI is not configured yet.' });
  }

  const incoming = Array.isArray(request.body?.messages) ? request.body.messages : [];
  const messages = incoming
    .filter((message) => ['user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    .slice(-20)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 8000) }));

  if (!messages.length) return response.status(400).json({ error: 'A message is required.' });

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions: NOVA_SYSTEM_PROMPT,
        input: messages
      })
    });
    const payload = await upstream.json();
    if (!upstream.ok) {
      console.error('OpenAI request failed', upstream.status, payload?.error?.type);
      return response.status(upstream.status).json({ error: 'NOVA could not answer right now.' });
    }
    const answer = textFromResponse(payload);
    if (!answer) return response.status(502).json({ error: 'NOVA returned an empty response.' });
    return response.status(200).json({ answer });
  } catch (error) {
    console.error('NOVA chat failure', error);
    return response.status(502).json({ error: 'NOVA is temporarily unavailable.' });
  }
}
