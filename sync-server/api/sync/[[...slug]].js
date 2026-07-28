// GET/POST /api/sync/<phrase>[/<profile>]
// GET  — returns group metadata + per-profile history
// POST — upserts watch history for a specific profile

const KV = require("../../lib/kv.js");

// Helper: resolve phrase + profile from the dynamic catch-all segments
// The Vercel catch-all [...slug] gives us everything after /api/sync/
// e.g. ["clock-forest-hind-toxic-train"] or ["clock-forest-hind-toxic-train", "reed"]
function parseSlug(slug) {
  if (!slug || slug.length === 0) return null;
  const phrase = slug[0]; // hyphens are fine — single segment
  const profile = slug.length > 1 ? slug.slice(1).join("/") : null;
  return { phrase: phrase.toLowerCase().trim(), profile };
}

module.exports = async function handler(req, res) {
  // CORS for CloudStream app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { phrase, profile: queryProfile } = req.query;
  const slug = parseSlug(req.query.slug);
  const p = slug?.phrase || phrase;
  if (!p) return res.status(400).json({ error: "Missing phrase" });

  const cleanPhrase = p.replace(/\s+/g, "-");
  const activeProfile = slug?.profile || queryProfile || null;
  const groupKey = `sync:${cleanPhrase}`;

  // ── GET ──
  if (req.method === "GET") {
    if (activeProfile) {
      const profileKey = `${groupKey}:${activeProfile}`;
      const data = await KV.get(profileKey);
      if (!data) return res.status(404).json({ error: "Profile not found" });
      return res.status(200).json(data);
    }

    const group = await KV.get(groupKey);
    if (!group) return res.status(404).json({ error: "Phrase not found" });

    const profiles = {};
    for (const prof of group.profiles || []) {
      const data = await KV.get(`${groupKey}:${prof}`);
      if (data) profiles[prof] = data;
    }

    return res.status(200).json({
      phrase: cleanPhrase,
      createdAt: group.createdAt,
      deviceCount: group.deviceCount,
      profiles,
    });
  }

  // ── POST ──
  if (req.method === "POST") {
    const { profile: bodyProfile, deviceId, history, replace } = req.body || {};
    const pName = bodyProfile || activeProfile;
    if (!pName) return res.status(400).json({ error: "Missing profile name" });
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
    if (!Array.isArray(history)) return res.status(400).json({ error: "history must be an array" });

    const now = Date.now();

    // Upsert group metadata
    let group = await KV.get(groupKey);
    if (!group) {
      group = { createdAt: now, deviceCount: 1, profiles: [pName], devices: [deviceId] };
    } else {
      if (!group.profiles.includes(pName)) group.profiles.push(pName);
      const allDevices = new Set(group.devices || []);
      allDevices.add(deviceId);
      group.devices = [...allDevices];
      group.deviceCount = group.devices.length;
    }
    await KV.set(groupKey, group);

    // Upsert profile history
    const profileKey = `${groupKey}:${pName}`;
    let existing = await KV.get(profileKey);
    if (!existing) {
      existing = { deviceId, profile: pName, history: [], createdAt: now, updatedAt: now };
    }

    if (replace) {
      existing.history = history;
    } else {
      // Merge — dedup by title+season+episode+timestamp
      const map = new Map();
      for (const e of existing.history) {
        map.set(`${e.title}|${e.season ?? ""}|${e.episode ?? ""}|${e.timestamp ?? ""}`, e);
      }
      for (const e of history) {
        map.set(`${e.title}|${e.season ?? ""}|${e.episode ?? ""}|${e.timestamp ?? ""}`, { ...e, updatedAt: now });
      }
      existing.history = [...map.values()];
    }

    existing.deviceId = deviceId;
    existing.updatedAt = now;
    await KV.set(profileKey, existing);

    return res.status(200).json({
      ok: true,
      phrase: cleanPhrase,
      profile: pName,
      entryCount: existing.history.length,
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
