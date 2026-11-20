export async function onRequest({ request, env }) {
  const key = env.AGNES_API_KEY;
  if (!key) return Response.json({ error: "AGNES_API_KEY secret is missing." }, { status: 503 });
  const base = "https://apihub.agnes-ai.com";
  const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  try {
    if (request.method === "POST") {
      const body = await request.json();
      const prompt = String(body.prompt || "").trim();
      if (!prompt || prompt.length > 1800) return Response.json({ error: "Prompt is required (max 1800 characters)." }, { status: 400 });
      const seconds = Math.max(4, Math.min(12, Number(body.seconds) || 5));
      const ratios = ["16:9","9:16","1:1","4:3","3:4","21:9"];
      const ratio = ratios.includes(body.aspect_ratio) ? body.aspect_ratio : "16:9";
      const response = await fetch(base + "/v1/videos", { method: "POST", headers, body: JSON.stringify({ model: "agnes-video-2.5-flash", prompt, mode: "text", seconds: String(seconds), size: "720P", aspect_ratio: ratio }) });
      const data = await response.json();
      if (!response.ok) return Response.json({ error: data.error?.message || data.message || "Video task could not be created.", details: data }, { status: response.status });
      return Response.json(data, { status: 202 });
    }
    if (request.method === "GET") {
      const video_id = new URL(request.url).searchParams.get("video_id");
      if (!video_id) return Response.json({ error: "video_id is required." }, { status: 400 });
      const response = await fetch(base + "/agnesapi?video_id=" + encodeURIComponent(video_id) + "&model_name=agnes-video-2.5-flash", { headers: { Authorization: "Bearer " + key } });
      const data = await response.json();
      return Response.json(data, { status: response.status });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (e) {
    return Response.json({ error: "Video API request failed.", message: e.message }, { status: 500 });
  }
}