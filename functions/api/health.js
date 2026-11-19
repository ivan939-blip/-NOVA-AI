export async function onRequest({ env }) {
  return Response.json({
    app: 'NOVA AI',
    api: 'online',
    ai: Boolean(env.AI),
    provider: 'Cloudflare Workers AI'
  }, { headers: { 'Cache-Control': 'no-store' } });
}
