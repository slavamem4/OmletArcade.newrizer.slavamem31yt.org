package com.newrizer.arcade.rtc

import android.content.Context
import android.content.Intent
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.e2ee.E2EEOptions
import io.livekit.android.room.Room
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

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

    suspend fun connect(url: String, token: String, roomKeyBase64: String?) {
        disconnect()
        val e2ee = roomKeyBase64?.let { key ->
            E2EEOptions().apply { keyProvider.setSharedKey(key, null) }
        }
        val created = LiveKit.create(
            appContext = context.applicationContext,
            options = RoomOptions(
                adaptiveStream = true,
                dynacast = true,
                e2eeOptions = e2ee,
            ),
        )
        room = created
        runCatching { created.connect(url, token) }
            .onFailure { error ->
                _state.value = _state.value.copy(connected = false, error = error.message)
                return
            }
        _state.value = _state.value.copy(
            connected = true,
            error = null,
            participants = created.remoteParticipants.size + 1,
        )
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
}
