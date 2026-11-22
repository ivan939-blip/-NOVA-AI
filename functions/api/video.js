const noStore = { 'Cache-Control': 'no-store' };

function config(env) {
  const base = String(env.NOVA_VIDEO_BACKEND_URL || '').replace(/\/$/, '');
  const token = String(env.NOVA_VIDEO_BACKEND_TOKEN || '');
  return base && token ? { base, token } : null;
}

function unavailable() {
  return Response.json({ error: 'Нейровідеосервер тимчасово не підключений. Спробуй пізніше або використай Motion Forge.', code: 'VIDEO_BACKEND_UNAVAILABLE' }, { status: 503, headers: noStore });
}

function backendUrl(base, request, media) {
  if (media) {
    const remote = new URL(media);
    const expected = new URL(base);
    const localCompanionUrl = ['127.0.0.1', 'localhost'].includes(remote.hostname);
    if ((!localCompanionUrl && remote.origin !== expected.origin) || !remote.pathname.startsWith('/media/')) throw new Error('INVALID_REMOTE_MEDIA');
    // The companion can only know its loopback address.  Never fetch that
    // address from the Worker: map its validated media path to the configured
    // public tunnel instead.
    return new URL(`${remote.pathname}${remote.search}`, expected).toString();
  }
  const requestUrl = new URL(request.url);
  const target = new URL(`${base}/api/video`);
  if (requestUrl.searchParams.has('video_id')) target.searchParams.set('video_id', requestUrl.searchParams.get('video_id'));
  return target.toString();
}

export async function onRequest({ request, env }) {
  if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, POST, OPTIONS', ...noStore } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...noStore, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  const settings = config(env);
  if (!settings) return unavailable();
  const requestUrl = new URL(request.url);
  const media = requestUrl.searchParams.get('media');
  try {
    const target = backendUrl(settings.base, request, media);
    const response = await fetch(target, { method: media ? 'GET' : request.method, headers: { Authorization: `Bearer ${settings.token}`, ...(request.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: request.method === 'POST' ? request.body : undefined });
    if (media) return new Response(response.body, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'video/webm', ...noStore } });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch { return Response.json({ error: 'Відеосервер повернув некоректну відповідь.', code: 'VIDEO_BACKEND_INVALID_RESPONSE' }, { status: 502, headers: noStore }); }
    if (data.video_url && response.ok) {
      const publicUrl = new URL(request.url);
      publicUrl.search = '';
      publicUrl.searchParams.set('media', data.video_url);
      data.video_url = publicUrl.toString();
    }
    return Response.json(data, { status: response.status, headers: noStore });
  } catch (error) {
    console.error('NOVA video proxy failed', error);
    return Response.json({ error: 'Не вдалося зв’язатися з нейровідеосервером.', code: 'VIDEO_BACKEND_ERROR' }, { status: 502, headers: noStore });
  }
}
