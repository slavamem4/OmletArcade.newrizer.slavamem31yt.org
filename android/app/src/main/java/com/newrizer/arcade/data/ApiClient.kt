package com.newrizer.arcade.data

import com.google.firebase.auth.FirebaseAuth
import com.newrizer.arcade.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, val code: String, override val message: String) : IOException(message)

/**
 * Thin HTTPS client for the Render backend.
 *
 * The backend does one thing: it turns a Firebase identity into a short lived
 * LiveKit grant. Everything else goes straight to Firebase under the database
 * rules, so this surface stays two endpoints wide.
 */
object ApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    // Render's free tier parks an idle instance and takes up to a minute to
    // answer the first request, so the read budget has to outlast a cold start.
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')

    private suspend fun idToken(): String = withContext(Dispatchers.IO) {
        val user = FirebaseAuth.getInstance().currentUser
            ?: throw ApiException(401, "unauthorized", "Not signed in")
        suspendCancellableCoroutine { continuation ->
            user.getIdToken(false)
                .addOnSuccessListener { result ->
                    val token = result.token
                    if (token.isNullOrEmpty()) {
                        continuation.resumeWithException(
                            ApiException(401, "unauthorized", "Could not read credential"),
                        )
                    } else {
                        continuation.resume(token)
                    }
                }
                .addOnFailureListener { error ->
                    continuation.resumeWithException(
                        ApiException(401, "unauthorized", error.message ?: "Credential refresh failed"),
                    )
                }
        }
    }

    /**
     * Wakes a parked instance without blocking the user interface. Failures are
     * ignored on purpose: this is a hint, not a dependency.
     */
    fun warmUp() {
        val request = Request.Builder().url("$baseUrl/healthz").get().build()
        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: IOException) = Unit
            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) = response.close()
        })
    }

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        val response = try {
            client.newCall(request).execute()
        } catch (error: java.io.InterruptedIOException) {
            throw ApiException(
                408,
                "timeout",
                "Сервер не ответил вовремя. Он мог заснуть — повторите через полминуты.",
            )
        } catch (error: UnknownHostException) {
            throw ApiException(0, "offline", "Нет связи с сервером. Проверьте интернет.")
        } catch (error: IOException) {
            throw ApiException(0, "offline", "Соединение прервалось: ${error.message ?: "сеть недоступна"}")
        }
        response.use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) return@use body
            val error = runCatching {
                (json.parseToJsonElement(body) as? JsonObject)?.get("error") as? JsonObject
            }.getOrNull()
            throw ApiException(
                response.code,
                error?.get("code")?.toString()?.trim('"') ?: "http_${response.code}",
                error?.get("message")?.toString()?.trim('"') ?: "Request failed",
            )
        }
    }

    suspend fun <B, T> post(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
    ): T {
        require(path.startsWith("/")) { "path must start with /" }
        val payload = json.encodeToString(bodySerializer, body).toRequestBody(jsonMedia)
        val builder = Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer ${idToken()}")
            .header("Accept", "application/json")
            .post(payload)
        if (BuildConfig.APP_CHECK_TOKEN.isNotEmpty()) {
            builder.header("X-App-Check", BuildConfig.APP_CHECK_TOKEN)
        }
        EmailProofStore.proofFor(FirebaseAuth.getInstance().currentUser?.uid)?.let { proof ->
            builder.header("X-Email-Verified", proof)
        }
        return json.decodeFromString(serializer, execute(builder.build()))
    }
}
