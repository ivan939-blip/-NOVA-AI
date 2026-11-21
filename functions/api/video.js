export async function onRequest() {
  return Response.json({
    error: 'NOVA генерує відео через локальний Wan2.1/ComfyUI companion, а не через хмарний API.',
    code: 'VIDEO_LOCAL_ONLY'
  }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
