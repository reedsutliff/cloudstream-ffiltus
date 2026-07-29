// POST /api/providers/report
// Global provider quality tracking (not per-phrase).
//
// Two report types:
//
// 1. Load report — called from CloudStream after loadLinks() returns
//    { provider: "Gogoanime", loadTimeMs: 2300, success: true/false, errorType?: "2004"|"timeout"|... }
//
// 2. Watch report — called when sync fires; watchPosition/duration show engagement
//    { provider: "Gogoanime", watchPositionSec: 1260, watchDurationSec: 1500 }
//    (can also be sent via the sync POST with provider field)

const KV = require("../../lib/kv.js");

const GLOBAL_STATS_KEY = "global:provider:stats";

// Score weights
const SCORE = {
  LOAD_SUCCESS_BASE: 10,
  LOAD_FAIL: -20,
  SPEED_FAST: 15,      // < 2s
  SPEED_OK: 5,         // 2-6s
  SPEED_SLOW: -5,      // 6-15s
  SPEED_PAIN: -15,     // > 15s
  WATCH_STARTED: 5,    // user actually started playing
  WATCH_COMPLETED: 30, // watched > 80% of episode
  WATCH_ABANDONED: -15,// watched < 20% of episode
  ERROR_2004: -25,     // DRM/content error
  ERROR_OTHER: -10,
  ERROR_CONNECTION: -15,
  DECAY_PER_DAY: 0.97, // older scores gradually matter less
};

function classifySpeed(loadTimeMs) {
  if (!loadTimeMs || loadTimeMs < 0) return 0;
  const s = loadTimeMs / 1000;
  if (s < 2) return SCORE.SPEED_FAST;
  if (s < 6) return SCORE.SPEED_OK;
  if (s < 15) return SCORE.SPEED_SLOW;
  return SCORE.SPEED_PAIN;
}

function computeWatchFraction(watchPositionSec, watchDurationSec) {
  if (!watchDurationSec || watchDurationSec <= 0) return null;
  if (!watchPositionSec || watchPositionSec <= 0) return null;
  return watchPositionSec / watchDurationSec;
}

function getOrInit(providers, name) {
  if (!providers[name]) {
    providers[name] = {
      firstSeen: Date.now(),
      // Load stats
      loadAttempts: 0,
      loadSuccesses: 0,
      loadFailures: 0,
      totalLoadTimeMs: 0,
      avgLoadTimeMs: null,
      // Playback stats
      playbacksStarted: 0,
      playbacksCompleted: 0,   // watched >80%
      playbacksAbandoned: 0,   // watched <20%
      totalWatchTimeMs: 0,
      avgWatchTimePerPlayback: null,
      maxWatchFraction: 0,
      // Error stats
      errorCount: 0,
      errorBreakdown: {},
      // Score
      score: 0,
      updatedAt: Date.now(),
    };
  }
  return providers[name];
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { provider, loadTimeMs, success, errorType, watchPositionSec, watchDurationSec, sourceUrl } = req.body || {};
  if (!provider) return res.status(400).json({ error: "Missing provider" });

  const now = Date.now();
  let stats = await KV.get(GLOBAL_STATS_KEY);
  if (!stats) {
    stats = { createdAt: now, updatedAt: now, providers: {} };
  }

  const p = getOrInit(stats.providers, provider.trim());

  // ── Apply recency decay to existing score ──
  const daysSinceUpdate = p.updatedAt ? (now - p.updatedAt) / (86400 * 1000) : 0;
  if (daysSinceUpdate > 0) {
    p.score = Math.round(p.score * Math.pow(SCORE.DECAY_PER_DAY, daysSinceUpdate));
  }

  // ── Load report ──
  if (loadTimeMs !== undefined || success !== undefined) {
    p.loadAttempts++;
    if (success) {
      p.loadSuccesses++;
      p.score += SCORE.LOAD_SUCCESS_BASE;
    } else {
      p.loadFailures++;
      p.score += SCORE.LOAD_FAIL;
    }

    if (loadTimeMs != null && loadTimeMs >= 0) {
      p.totalLoadTimeMs = (p.totalLoadTimeMs || 0) + loadTimeMs;
      p.avgLoadTimeMs = Math.round(p.totalLoadTimeMs / p.loadAttempts);
      p.score += classifySpeed(loadTimeMs);
    }

    if (errorType) {
      p.errorCount = (p.errorCount || 0) + 1;
      if (!p.errorBreakdown) p.errorBreakdown = {};
      p.errorBreakdown[errorType] = (p.errorBreakdown[errorType] || 0) + 1;

      if (errorType === "2004") p.score += SCORE.ERROR_2004;
      else if (errorType === "timeout" || errorType === "connection") p.score += SCORE.ERROR_CONNECTION;
      else p.score += SCORE.ERROR_OTHER;
    }
  }

  // ── Watch report (playback engagement) ──
  if (watchPositionSec !== undefined || watchDurationSec !== undefined) {
    const fraction = computeWatchFraction(watchPositionSec, watchDurationSec);

    if (fraction !== null) {
      p.playbacksStarted = (p.playbacksStarted || 0) + 1;
      p.totalWatchTimeMs = (p.totalWatchTimeMs || 0) + (watchPositionSec * 1000);

      if (fraction > (p.maxWatchFraction || 0)) {
        p.maxWatchFraction = fraction;
      }

      if (fraction >= 0.8) {
        p.playbacksCompleted = (p.playbacksCompleted || 0) + 1;
        p.score += SCORE.WATCH_COMPLETED;
      } else if (fraction < 0.2) {
        p.playbacksAbandoned = (p.playbacksAbandoned || 0) + 1;
        p.score += SCORE.WATCH_ABANDONED;
      } else {
        p.score += SCORE.WATCH_STARTED;
      }

      p.avgWatchTimePerPlayback = p.playbacksStarted > 0
        ? Math.round(p.totalWatchTimeMs / p.playbacksStarted)
        : null;
    }
  }

  // Clamp score
  p.score = Math.max(-100, Math.min(100, p.score));
  p.updatedAt = now;
  stats.updatedAt = now;

  await KV.set(GLOBAL_STATS_KEY, stats);

  return res.status(200).json({
    ok: true,
    provider: provider.trim(),
    score: p.score,
    loadAttempts: p.loadAttempts,
    loadSuccessRate: p.loadAttempts > 0 ? Math.round((p.loadSuccesses / p.loadAttempts) * 100) : 0,
    playbackCompletionRate: p.playbacksStarted > 0
      ? Math.round(((p.playbacksCompleted || 0) / p.playbacksStarted) * 100)
      : 0,
    avgLoadTimeMs: p.avgLoadTimeMs,
  });
};
