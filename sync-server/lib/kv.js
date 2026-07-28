// Upstash Redis REST client — works on Vercel free tier.
// Expects KV_REST_API_URL + KV_REST_API_TOKEN (or single KV_URL redis:// URL)

const REST_URL = process.env.KV_REST_API_URL || "";
const REST_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_URL = process.env.KV_URL || "";

function parseRedisUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const port = u.port || 443;
    const proto = u.protocol === "rediss:" ? "https" : "http";
    return { url: proto + "://" + host + ":" + port, token: u.password };
  } catch { return null; }
}

function getEndpoint() {
  if (REST_URL && REST_TOKEN) return { url: REST_URL, token: REST_TOKEN };
  if (KV_URL) return parseRedisUrl(KV_URL);
  return null;
}

async function cmd(command, ...args) {
  const ep = getEndpoint();
  if (!ep) return memFallback(command, ...args);
  const auth = Buffer.from(":" + ep.token).toString("base64");
  const res = await fetch(ep.url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command, ...args]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Upstash error " + res.status + ": " + text);
  }
  return res.json();
}

// In-memory fallback for dev
const mem = new Map();
async function memFallback(command, ...args) {
  switch (command) {
    case "GET": return mem.get(args[0]) ?? null;
    case "SET": mem.set(args[0], args[1]); return "OK";
    case "DEL": mem.delete(args[0]); return 1;
    case "EXISTS": return mem.has(args[0]) ? 1 : 0;
    default: return null;
  }
}

async function get(key) {
  const raw = await cmd("GET", key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}
async function set(key, value) {
  return cmd("SET", key, typeof value === "string" ? value : JSON.stringify(value));
}
async function del(key) { return cmd("DEL", key); }
async function exists(key) { return cmd("EXISTS", key); }

module.exports = { get, set, del, exists, cmd };
