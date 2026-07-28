// GET/POST /api/sync/<phrase>[/<profile>]
// GET  — returns group metadata + per-profile history
// POST — upserts watch history for a specific profile
//
// Reconciliation:
//   Per-entry dedup key: title|season|episode  (NOT timestamp)
//   Conflict: newer updatedAt wins (5s grace window → most progressed wins)
//   watchedEpisodes: always take max (never regress)
//   Atomic upsert via Redis EVAL (Lua) to prevent race conditions

const KV = require("../../lib/kv.js");

// ── Helpers ──

function parseSlug(slug) {
  if (!slug || slug.length === 0) return null;
  const phrase = slug[0];
  const profile = slug.length > 1 ? slug.slice(1).join("/") : null;
  return { phrase: phrase.toLowerCase().trim(), profile };
}

// Build dedup / merge key from a history entry
function entryKey(e) {
  return `${e.title ?? ""}|${e.season ?? ""}|${e.episode ?? ""}`;
}

// Smart merge: reconcile two entries for the same title|season|episode
function mergeEntry(existing, incoming) {
  const TIMESTAMP_GRACE_MS = 5000; // 5-second window = "same session"

  const exUpdated = existing.updatedAt ?? 0;
  const inUpdated = incoming.updatedAt ?? 0;
  const gap = Math.abs(exUpdated - inUpdated);

  let base;
  if (gap > TIMESTAMP_GRACE_MS) {
    // Far apart → newer timestamp wins
    base = exUpdated > inUpdated ? existing : incoming;
  } else {
    // Same session / close timing → most progressed wins
    base = (incoming.watchPosition ?? 0) >= (existing.watchPosition ?? 0)
      ? incoming : existing;
  }

  return {
    ...base,
    // Progress never regresses — always take max watchedEpisodes
    watchedEpisodes: max(
      existing.watchedEpisodes ?? 0,
      incoming.watchedEpisodes ?? 0
    ),
    // Also take max watchPosition if the other is farther along
    watchPosition: max(
      existing.watchPosition ?? 0,
      incoming.watchPosition ?? 0
    ),
    // updatedAt reflects the latest activity
    updatedAt: Math.max(exUpdated, inUpdated),
  };
}

function max(a, b) { return a > b ? a : b; }

// Merge incoming history[] into existing history[], returns new array
function mergeHistory(existingHistory, incomingHistory) {
  const map = new Map();

  // Index existing entries by dedup key
  for (const e of existingHistory) {
    map.set(entryKey(e), { ...e });
  }

  // Merge or add each incoming entry
  for (const e of incomingHistory) {
    const key = entryKey(e);
    if (map.has(key)) {
      map.set(key, mergeEntry(map.get(key), e));
    } else {
      map.set(key, { ...e });
    }
  }

  return [...map.values()];
}

// ── Atomic Lua merge script for Upstash Redis ──
// Runs as EVAL on the Redis server so GET+SET is atomic.
// KEYS[1] = profileKey, ARGV[1] = incomingHistory JSON, ARGV[2] = now timestamp
const LUA_MERGE_SCRIPT = `
  local key = KEYS[1]
  local incoming = cjson.decode(ARGV[1])
  local now = tonumber(ARGV[2])
  local raw = redis.call("GET", key)
  local existing = raw and cjson.decode(raw) or { history = {}, createdAt = now, updatedAt = now }

  local function entry_key(e)
    return (e.title or "") .. "|" .. (e.season or "") .. "|" .. (e.episode or "")
  end

  local map = {}
  for _, e in ipairs(existing.history or {}) do
    map[entry_key(e)] = e
  end

  for _, e in ipairs(incoming) do
    local k = entry_key(e)
    if map[k] then
      local old = map[k]
      local ex_up = old.updatedAt or 0
      local in_up = e.updatedAt or 0
      local gap = math.abs(ex_up - in_up)
      local base
      if gap > 5000 then
        if ex_up > in_up then base = old else base = e end
      else
        local old_pos = old.watchPosition or 0
        local in_pos = e.watchPosition or 0
        if in_pos >= old_pos then base = e else base = old end
      end
      base.watchedEpisodes = math.max(old.watchedEpisodes or 0, e.watchedEpisodes or 0)
      base.watchPosition = math.max(old.watchPosition or 0, e.watchPosition or 0)
      base.updatedAt = math.max(ex_up, in_up)
      map[k] = base
    else
      map[k] = e
    end
  end

  local merged = {}
  for _, v in pairs(map) do table.insert(merged, v) end

  existing.history = merged
  existing.updatedAt = now

  redis.call("SET", key, cjson.encode(existing))
  return cjson.encode({ ok = true, entryCount = #merged, updatedAt = now })
end
`;

// ── Handler ──

module.exports = async function handler(req, res) {
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

    const profileKey = `${groupKey}:${pName}`;

    if (replace) {
      // Full replace — client says "this is the entire truth"
      const payload = { deviceId, profile: pName, history, createdAt: now, updatedAt: now };
      await KV.set(profileKey, payload);
      return res.status(200).json({ ok: true, phrase: cleanPhrase, profile: pName, entryCount: history.length, mode: "replace" });
    }

    // ── Smart atomic merge ──
    // Try atomic Lua merge first (Upstash supports EVAL)
    try {
      const result = await KV.cmd("EVAL", LUA_MERGE_SCRIPT, 1, profileKey, JSON.stringify(history), String(now));
      const parsed = JSON.parse(result);
      return res.status(200).json({
        ok: true,
        phrase: cleanPhrase,
        profile: pName,
        entryCount: parsed.entryCount,
        mode: "atomic-merge",
      });
    } catch (e) {
      // EVAL not supported (e.g. in-memory fallback) → fall through to JS merge
    }

    // ── Non-atomic JS merge fallback ──
    let existing = await KV.get(profileKey);
    if (!existing) {
      existing = { deviceId, profile: pName, history: [], createdAt: now, updatedAt: now };
    }

    if (replace) {
      existing.history = history;
    } else {
      existing.history = mergeHistory(existing.history, history);
    }

    existing.deviceId = deviceId;
    existing.updatedAt = now;
    await KV.set(profileKey, existing);

    return res.status(200).json({
      ok: true,
      phrase: cleanPhrase,
      profile: pName,
      entryCount: existing.history.length,
      mode: "js-merge",
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
