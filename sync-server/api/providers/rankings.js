// GET /api/providers/rankings
// Returns global provider rankings sorted by score descending.

const KV = require("../../lib/kv.js");
const GLOBAL_STATS_KEY = "global:provider:stats";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { limit: limitStr, minAttempts: minStr } = req.query;
  const limit = Math.min(parseInt(limitStr) || 200, 200);
  const minAttempts = parseInt(minStr) || 1;

  const stats = await KV.get(GLOBAL_STATS_KEY);
  if (!stats || !stats.providers) {
    return res.status(200).json({ providers: [], totalReports: 0 });
  }

  const entries = Object.entries(stats.providers)
    .filter(([_, d]) => d.loadAttempts >= minAttempts)
    .map(([name, d]) => ({
      name,
      score: d.score || 0,
      loadAttempts: d.loadAttempts,
      loadSuccesses: d.loadSuccesses || 0,
      loadFailures: d.loadFailures || 0,
      loadSuccessRate: d.loadAttempts > 0
        ? Math.round(((d.loadSuccesses || 0) / d.loadAttempts) * 100)
        : 0,
      avgLoadTimeMs: d.avgLoadTimeMs,
      playbacksStarted: d.playbacksStarted || 0,
      playbacksCompleted: d.playbacksCompleted || 0,
      playbacksAbandoned: d.playbacksAbandoned || 0,
      playbackCompletionRate: d.playbacksStarted > 0
        ? Math.round(((d.playbacksCompleted || 0) / d.playbacksStarted) * 100)
        : 0,
      avgWatchTimeMs: d.avgWatchTimePerPlayback,
      maxWatchFraction: d.maxWatchFraction
        ? Math.round(d.maxWatchFraction * 100) + "%"
        : null,
      errorCount: d.errorCount || 0,
      topErrors: d.errorBreakdown
        ? Object.entries(d.errorBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([t, c]) => `${t}(${c})`)
        : [],
      lastReported: d.updatedAt,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return res.status(200).json({
    providers: entries,
    totalReports: entries.reduce((s, e) => s + e.loadAttempts, 0),
    generatedAt: Date.now(),
  });
};
