// Intermediario opcional y gratuito (Cloudflare Workers) para Cuentas Claras.
// Úsalo solo si el navegador bloquea la conexión directa con Groq. Además, así la clave no está en el móvil.
// 1. dash.cloudflare.com → Workers & Pages → Create → Worker → pega este código → Deploy.
// 2. Settings → Variables → añade el secreto GROQ_API_KEY con tu clave de Groq.
// 3. En la app: Ajustes → Inteligencia artificial → Opciones avanzadas → Intermediario = la dirección del worker.
const ALLOWED_ORIGIN = "https://nanokaos.github.io";

export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/chat") return new Response("No encontrado", { status: 404, headers: cors });
    if (req.headers.get("Origin") !== ALLOWED_ORIGIN) return new Response("Origen no permitido", { status: 403, headers: cors });
    const body = await req.text();
    if (body.length > 60000) return new Response("Petición demasiado grande", { status: 413, headers: cors });
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` }, body,
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
