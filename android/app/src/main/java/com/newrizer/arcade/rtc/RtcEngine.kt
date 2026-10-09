package com.newrizer.arcade.rtc

import android.content.Context
import android.content.Intent
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.e2ee.E2EEOptions
import io.livekit.android.room.Room
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withTimeout

/**
 * LiveKit session wrapper.
 *
 * The access token always comes from the backend and expires quickly; media is
 * encrypted with the room key before it reaches the SFU, so the server relays
 * opaque frames.
 */
class RtcEngine(private val context: Context) {

    private var room: Room? = null
    private val _state = MutableStateFlow(RtcState())
    val state: StateFlow<RtcState> = _state

    data class RtcState(
        val connected: Boolean = false,
        val publishing: Boolean = false,
        val microphoneOn: Boolean = false,
        val screenShareOn: Boolean = false,
        val participants: Int = 0,
        val error: String? = null,
    )

    /**
     * Connects with a bounded wait and a second attempt.
     *
     * A stalled TCP handshake on a flaky mobile network otherwise leaves the
     * caller waiting forever, which looked exactly like "streams do not work".
     */
    suspend fun connect(url: String, token: String, roomKeyBase64: String?) {
        disconnect()
        val e2ee = roomKeyBase64?.let { key ->
            E2EEOptions().apply { keyProvider.setSharedKey(key, null) }
        }

        var lastError: String? = null
        repeat(CONNECT_ATTEMPTS) { attempt ->
            val created = LiveKit.create(
                appContext = context.applicationContext,
                options = RoomOptions(
                    adaptiveStream = true,
                    dynacast = true,
                    e2eeOptions = e2ee,
                ),
            )
            room = created

            val outcome = runCatching {
                withTimeout(CONNECT_TIMEOUT_MS) { created.connect(url, token) }
            }
            if (outcome.isSuccess) {
                _state.value = _state.value.copy(
                    connected = true,
                    error = null,
                    participants = created.remoteParticipants.size + 1,
                )
                return
            }

            val error = outcome.exceptionOrNull()
            lastError = when (error) {
                is TimeoutCancellationException -> "Сервер не ответил вовремя"
                else -> error?.message ?: "Не удалось подключиться"
            }
            runCatching {
                created.disconnect()
                created.release()
            }
            room = null
            if (attempt < CONNECT_ATTEMPTS - 1) delay(RETRY_DELAY_MS)
        }

        _state.value = _state.value.copy(connected = false, error = lastError)
    }

    suspend fun setMicrophone(enabled: Boolean) {
        val current = room ?: return
        runCatching { current.localParticipant.setMicrophoneEnabled(enabled) }
            .onSuccess { _state.value = _state.value.copy(microphoneOn = enabled) }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    suspend fun setCamera(enabled: Boolean) {
        val current = room ?: return
        runCatching { current.localParticipant.setCameraEnabled(enabled) }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    /** [projectionData] is the result Intent from MediaProjection consent. */
    suspend fun setScreenShare(enabled: Boolean, projectionData: Intent?) {
        val current = room ?: return
        runCatching {
            if (enabled && projectionData != null) {
                current.localParticipant.setScreenShareEnabled(
                    true,
                    ScreenCaptureParams(mediaProjectionPermissionResultData = projectionData),
                )
            } else {
                current.localParticipant.setScreenShareEnabled(false)
            }
        }
            .onSuccess {
                _state.value = _state.value.copy(screenShareOn = enabled, publishing = enabled)
            }
            .onFailure { _state.value = _state.value.copy(error = it.message) }
    }

    fun disconnect() {
        room?.disconnect()
        room?.release()
        room = null
        _state.value = RtcState()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 15_000L
        const val CONNECT_ATTEMPTS = 2
        const val RETRY_DELAY_MS = 1_200L
    }
}
