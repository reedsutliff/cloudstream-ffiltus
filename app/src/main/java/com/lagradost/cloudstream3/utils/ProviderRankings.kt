package com.lagradost.cloudstream3.utils

import com.lagradost.cloudstream3.mvvm.logError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URL

/**
 * Fetches and caches global provider rankings from the sync server.
 * Used to sort sources by provider quality before showing the selector.
 */
object ProviderRankings {
    private var cachedRankings: Map<String, Int>? = null
    private var lastFetchMs: Long = 0
    private const val CACHE_TTL_MS = 15 * 60 * 1000L // 15 minutes

    /**
     * Get cached rankings or fetch fresh ones from the sync server.
     * Returns a map of provider name → score.
     */
    suspend fun getRankings(serverUrl: String): Map<String, Int> {
        val now = System.currentTimeMillis()
        if (cachedRankings != null && (now - lastFetchMs) < CACHE_TTL_MS) {
            return cachedRankings!!
        }

        return try {
            val text = withContext(Dispatchers.IO) {
                URL("$serverUrl/api/providers/rankings?minAttempts=2&limit=100").readText()
            }
            val json = JSONObject(text)
            val providers = json.optJSONArray("providers") ?: return cachedRankings ?: emptyMap()
            val map = mutableMapOf<String, Int>()
            for (i in 0 until providers.length()) {
                val entry = providers.getJSONObject(i)
                map[entry.optString("name")] = entry.optInt("score", 0)
            }
            cachedRankings = map
            lastFetchMs = now
            map
        } catch (e: Exception) {
            logError(e)
            cachedRankings ?: emptyMap()
        }
    }

    /**
     * Get the score for a specific provider, or null if unknown.
     */
    suspend fun getScore(serverUrl: String, providerName: String): Int? {
        return getRankings(serverUrl)[providerName]
    }

    /**
     * Clear the cache (e.g., when settings change).
     */
    fun clearCache() {
        cachedRankings = null
        lastFetchMs = 0
    }
}
