// Intermediario opcional y gratuito (Cloudflare Workers) para Veranza.
// Úsalo solo si el navegador bloquea la conexión directa con Groq o con Fish Audio.
// 1. dash.cloudflare.com → Workers & Pages → Create → Worker → pega este código → Deploy.
// 2. (Opcional) Settings → Variables → secreto GROQ_API_KEY. Si no lo pones, se usa la clave que tengas en la app.
//    Para la voz no hace falta secreto: la app manda su propia clave de Fish Audio (o pon FISH_API_KEY si prefieres).
// 3. En la app: Ajustes → Inteligencia artificial → Opciones avanzadas → Intermediario = la dirección del worker.
const ALLOWED_ORIGIN = "https://nanokaos.github.io";

export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Headers": "Content-Type, Authorization, model", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (req.method !== "POST" || !["/chat", "/fish"].includes(url.pathname)) return new Response("No encontrado", { status: 404, headers: cors });
    if (req.headers.get("Origin") !== ALLOWED_ORIGIN) return new Response("Origen no permitido", { status: 403, headers: cors });
    const body = await req.text();
    if (body.length > 60000) return new Response("Petición demasiado grande", { status: 413, headers: cors });

    if (url.pathname === "/fish") {
      const auth = env.FISH_API_KEY ? `Bearer ${env.FISH_API_KEY}` : req.headers.get("Authorization") || "";
      const r = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: auth, model: req.headers.get("model") || "s2.1-pro-free" }, body,
      });
      return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": r.headers.get("Content-Type") || "audio/mpeg" } });
    }

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: env.GROQ_API_KEY ? `Bearer ${env.GROQ_API_KEY}` : req.headers.get("Authorization") || "" }, body,
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
