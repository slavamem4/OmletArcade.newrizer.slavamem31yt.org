package com.newrizer.arcade.data

import com.google.firebase.auth.FirebaseAuth
import com.newrizer.arcade.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.KSerializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, val code: String, override val message: String) : IOException(message)

/**
 * Thin HTTPS client for the Render backend.
 * Authentication is a Firebase ID token; the app holds no service credential
 * and never sees a LiveKit API key.
 */
object ApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
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

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) return@use body
            val code = runCatching {
                json.parseToJsonElement(body)
                    .let { it as? kotlinx.serialization.json.JsonObject }
                    ?.get("error")
                    ?.let { it as? kotlinx.serialization.json.JsonObject }
            }.getOrNull()
            val errorCode = code?.get("code")?.toString()?.trim('"') ?: "http_${response.code}"
            val errorMessage = code?.get("message")?.toString()?.trim('"') ?: "Request failed"
            throw ApiException(response.code, errorCode, errorMessage)
        }
    }

    private suspend fun builder(path: String): Request.Builder {
        require(path.startsWith("/")) { "path must start with /" }
        val request = Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer ${idToken()}")
            .header("Accept", "application/json")
        if (BuildConfig.APP_CHECK_TOKEN.isNotEmpty()) {
            request.header("X-App-Check", BuildConfig.APP_CHECK_TOKEN)
        }
        return request
    }

    suspend fun <T> get(path: String, serializer: KSerializer<T>): T {
        val response = execute(builder(path).get().build())
        return json.decodeFromString(serializer, response)
    }

    suspend fun <B, T> post(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
    ): T {
        val payload = json.encodeToString(bodySerializer, body).toRequestBody(jsonMedia)
        val response = execute(builder(path).post(payload).build())
        return json.decodeFromString(serializer, response)
    }

    suspend fun <T> postEmpty(path: String, serializer: KSerializer<T>): T {
        val payload = "{}".toRequestBody(jsonMedia)
        val response = execute(builder(path).post(payload).build())
        return json.decodeFromString(serializer, response)
    }

    suspend fun <B, T> put(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
    ): T {
        val payload = json.encodeToString(bodySerializer, body).toRequestBody(jsonMedia)
        val response = execute(builder(path).put(payload).build())
        return json.decodeFromString(serializer, response)
    }
}
