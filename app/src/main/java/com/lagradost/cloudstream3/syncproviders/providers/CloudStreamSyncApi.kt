package com.lagradost.cloudstream3.syncproviders.providers

import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.syncproviders.AuthData
import com.lagradost.cloudstream3.syncproviders.AuthLoginRequirement
import com.lagradost.cloudstream3.syncproviders.AuthLoginResponse
import com.lagradost.cloudstream3.syncproviders.AuthToken
import com.lagradost.cloudstream3.syncproviders.AuthUser
import com.lagradost.cloudstream3.syncproviders.SyncAPI
import com.lagradost.cloudstream3.ui.SyncWatchType
import com.lagradost.cloudstream3.ui.library.ListSorting
import com.lagradost.cloudstream3.utils.txt
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * CloudStream Sync Provider
 *
 * Syncs watch history via the ffilt.us CloudStream Sync API using a
 * human-readable phrase-based approach (no account needed).
 *
 * The "auth" is the sync phrase and profile name stored in AuthToken.
 */
class CloudStreamSyncApi : SyncAPI() {
    override val name = "CloudStream Sync"
    override val idPrefix = "cssync"
    override val requiresLogin = false
    override val hasInApp = true
    override val hasOAuth2 = false
    override val hasPin = false
    override val supportedWatchTypes: Set<SyncWatchType> = setOf(
        SyncWatchType.COMPLETED,
        SyncWatchType.CURRENT,
        SyncWatchType.PLANNED,
        SyncWatchType.DROPPED,
        SyncWatchType.ONHOLD,
    )

    // Default server URL — user-configurable via the payload
    private val defaultServerUrl = "https://cloudstream-sync.vercel.app"

    // ── Auth (phrase-based, no real account) ──

    override val inAppLoginRequirement = AuthLoginRequirement(
        password = false,
        username = true,   // sync phrase
        email = false,
        server = true,     // Vercel server URL (defaulted)
    )

    override suspend fun login(form: AuthLoginResponse): AuthToken? {
        val phrase = form.username?.trim()?.lowercase() ?: return null
        if (phrase.length < 5) return null // too short to be valid
        val server = form.server?.trim()?.lowercase() ?: defaultServerUrl

        return AuthToken(
            accessToken = phrase,
            payload = server,
            // No expiry — phrase is permanent
        )
    }

    override suspend fun user(token: AuthToken?): AuthUser? {
        val phrase = token?.accessToken ?: return null
        // Use hash of the phrase as a stable user ID
        return AuthUser(
            name = "CS:${phrase.take(16)}…",
            id = phrase.hashCode(),
            profilePicture = null,
        )
    }

    override suspend fun invalidateToken(token: AuthToken) {
        // No server-side token invalidation needed
    }

    // ── Sync (watch history) ──

    private fun getPhrase(auth: AuthData?): String? =
        auth?.token?.accessToken?.takeIf { it.isNotBlank() }

    private fun getServer(auth: AuthData?): String =
        auth?.token?.payload?.takeIf { it.isNotBlank() } ?: defaultServerUrl

    private fun getProfile(auth: AuthData?): String =
        auth?.user?.name?.takeIf { it.isNotBlank() } ?: "default"

    override suspend fun updateStatus(
        auth: AuthData?,
        id: String,
        newStatus: AbstractSyncStatus
    ): Boolean {
        val phrase = getPhrase(auth) ?: return false
        val server = getServer(auth)
        val profile = getProfile(auth)

        // Build the history entry
        val entry = JSONObject().apply {
            put("title", id)
            put("timestamp", System.currentTimeMillis() / 1000)
            put("updatedAt", System.currentTimeMillis())

            when (newStatus.status) {
                SyncWatchType.COMPLETED -> put("status", "completed")
                SyncWatchType.CURRENT -> put("status", "watching")
                SyncWatchType.PLANNED -> put("status", "planned")
                SyncWatchType.DROPPED -> put("status", "dropped")
                SyncWatchType.ONHOLD -> put("status", "on_hold")
                else -> put("status", "watching")
            }

            newStatus.watchedEpisodes?.let { put("episodes", it) }
            newStatus.watchPosition?.let { put("watchPosition", it) }
            newStatus.watchDuration?.let { put("watchDuration", it) }
            newStatus.score?.let {
                put("score", it.toInt(10))
            }
        }

        val body = JSONObject().apply {
            put("profile", profile)
            put("deviceId", "cloudstream")
            put("history", JSONArray(listOf(entry)))
        }

        return try {
            val url = URL("$server/api/sync/$phrase/$profile")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("User-Agent", "CloudStream/3.0")
            conn.outputStream.write(body.toString().toByteArray())
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (e: Exception) {
            false
        }
    }

    override suspend fun status(auth: AuthData?, id: String): AbstractSyncStatus? {
        val phrase = getPhrase(auth) ?: return null
        val server = getServer(auth)
        val profile = getProfile(auth)

        return try {
            val url = URL("$server/api/sync/$phrase/$profile")
            val text = url.readText()
            val json = JSONObject(text)
            val history = json.optJSONArray("history") ?: return null

            // Find matching entry
            for (i in 0 until history.length()) {
                val entry = history.getJSONObject(i)
                if (entry.optString("title") == id) {
                    val watchType = when (entry.optString("status", "watching")) {
                        "completed" -> SyncWatchType.COMPLETED
                        "watching"  -> SyncWatchType.CURRENT
                        "planned"   -> SyncWatchType.PLANNED
                        "dropped"   -> SyncWatchType.DROPPED
                        "on_hold"   -> SyncWatchType.ONHOLD
                        else        -> SyncWatchType.CURRENT
                    }
                    val scoreVal = entry.optInt("score", -1).let {
                        if (it > 0) Score.percentage(it * 10) else null
                    }
                    val episodes = entry.optInt("episodes", -1).let {
                        if (it >= 0) it else null
                    }
                    return SyncStatus(
                        status = watchType,
                        score = scoreVal,
                        watchedEpisodes = episodes,
                    )
                }
            }
            null
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun load(auth: AuthData?, id: String): SyncResult? {
        // Basic metadata — not much we can infer from just an ID
        return SyncResult(id = id, title = id)
    }

    override suspend fun search(auth: AuthData?, query: String): List<SyncSearchResult>? {
        return null // No remote search — users sync from CloudStream library
    }

    override suspend fun library(auth: AuthData?): LibraryMetadata? {
        val phrase = getPhrase(auth) ?: return null
        val server = getServer(auth)
        val profile = getProfile(auth)

        return try {
            val url = URL("$server/api/sync/$phrase/$profile")
            val text = url.readText()
            val json = JSONObject(text)
            val history = json.optJSONArray("history") ?: return null

            val items = mutableListOf<LibraryItem>()
            for (i in 0 until history.length()) {
                val entry = history.getJSONObject(i)
                val title = entry.optString("title", "Unknown")
                val status = entry.optString("status", "watching")
                val score = entry.optInt("score", -1)
                val episodes = entry.optInt("episodes", -1)
                val updatedAt = entry.optLong("updatedAt", 0L)

                val watchType = when (status) {
                    "completed" -> SyncWatchType.COMPLETED
                    "watching"  -> SyncWatchType.CURRENT
                    "planned"   -> SyncWatchType.PLANNED
                    "dropped"   -> SyncWatchType.DROPPED
                    "on_hold"   -> SyncWatchType.ONHOLD
                    else        -> SyncWatchType.CURRENT
                }

                items.add(
                    LibraryItem(
                        name = title,
                        url = title,
                        syncId = title,
                        episodesCompleted = if (episodes >= 0) episodes else null,
                        episodesTotal = null,
                        personalRating = if (score > 0) Score.percentage(score * 10) else null,
                        lastUpdatedUnixTime = updatedAt,
                        apiName = name,
                        type = null,
                        posterUrl = null,
                        posterHeaders = null,
                        quality = null,
                        releaseDate = null,
                    )
                )
            }

            LibraryMetadata(
                allLibraryLists = listOf(
                    LibraryList(
                        name = txt("Synced History"),
                        items = items
                    )
                ),
                supportedListSorting = setOf(
                    ListSorting.AlphabeticalA,
                    ListSorting.AlphabeticalZ,
                    ListSorting.UpdatedNew,
                    ListSorting.UpdatedOld,
                )
            )
        } catch (e: Exception) {
            null
        }
    }
}
