package com.newrizer.arcade.data

import okio.ByteString
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Remote Minecraft hosting without a dedicated game server.
 *
 * The world lives on the host's phone (Bedrock exposes it on loopback when
 * "Visible to LAN players" is on). [McTunnelHost] ships every game datagram
 * through the backend relay; [McTunnelJoin] does the mirror image on the
 * player's phone, where Minecraft is told to connect to 127.0.0.1 and never
 * learns the traffic crosses the internet in between.
 *
 * Framing matches the server: host-bound frames carry a 4 byte big-endian
 * client id, and an empty payload for an id means that player left.
 */
private const val MC_PORT = 19132
private const val BUFFER = 2048

class McTunnelHost(private val roomId: String) : WebSocketListener() {

    private val sockets = ConcurrentHashMap<Int, DatagramSocket>()

    @Volatile
    private var running = false

    @Volatile
    private var socket: WebSocket? = null

    suspend fun start() {
        running = true
        val url = ApiClient.tunnelUrl("host", roomId, ApiClient.tunnelToken())
        socket = ApiClient.newWebSocket(url, this)
    }

    fun stop() {
        running = false
        socket?.close(1000, null)
        socket = null
        for (datagram in sockets.values) runCatching { datagram.close() }
        sockets.clear()
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (!running) return
        val frame = bytes.toByteArray()
        if (frame.size < 4) return
        val id = ByteBuffer.wrap(frame, 0, 4).int
        val payload = frame.size - 4
        if (payload == 0) {
            sockets.remove(id)?.close()
            return
        }
        val target = sockets[id] ?: openSocket(id)?.also { sockets[id] = it } ?: return
        runCatching {
            target.send(DatagramPacket(frame, 4, payload, InetSocketAddress("127.0.0.1", MC_PORT)))
        }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
        // The relay went away; the world stays reachable on this phone only.
        for (datagram in sockets.values) runCatching { datagram.close() }
        sockets.clear()
    }

    private fun openSocket(id: Int): DatagramSocket? = runCatching {
        val datagram = DatagramSocket(null)
        datagram.bind(InetSocketAddress("127.0.0.1", 0))
        thread(isDaemon = true, name = "tunnel-host-$id") { pump(id, datagram) }
        datagram
    }.getOrNull()

    /** Reads one player's answers from the local game and pushes them upstream. */
    private fun pump(id: Int, datagram: DatagramSocket) {
        val buffer = ByteArray(BUFFER)
        while (running && !datagram.isClosed) {
            val packet = DatagramPacket(buffer, buffer.size)
            val received = runCatching { datagram.receive(packet); true }.getOrDefault(false)
            if (!received) return
            val frame = ByteBuffer.allocate(4 + packet.length)
                .putInt(id)
                .put(packet.data, packet.offset, packet.length)
                .array()
            val sent = socket?.send(ByteString.of(*frame)) ?: return
            if (!sent) return
        }
    }
}

class McTunnelJoin(private val roomId: String) : WebSocketListener() {

    @Volatile
    private var running = false

    @Volatile
    private var socket: WebSocket? = null

    @Volatile
    private var gameAddress: InetSocketAddress? = null
    private var local: DatagramSocket? = null

    /** @return the loopback port the player enters into Minecraft. */
    suspend fun start(): Int {
        val datagram = (MC_PORT..MC_PORT + 4).firstNotNullOfOrNull { port ->
            runCatching {
                DatagramSocket(null).apply { bind(InetSocketAddress("127.0.0.1", port)) }
            }.getOrNull()
        } ?: throw IllegalStateException("Порт 19132 занят другим приложением")
        local = datagram
        running = true
        thread(isDaemon = true, name = "tunnel-join") { pump(datagram) }
        val url = ApiClient.tunnelUrl("join", roomId, ApiClient.tunnelToken())
        socket = ApiClient.newWebSocket(url, this)
        return datagram.localPort
    }

    fun stop() {
        running = false
        socket?.close(1000, null)
        socket = null
        runCatching { local?.close() }
        local = null
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (!running) return
        val target = gameAddress ?: return
        val datagram = local ?: return
        val frame = bytes.toByteArray()
        runCatching { datagram.send(DatagramPacket(frame, frame.size, target)) }
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
        running = false
    }

    /** Reads the Minecraft client's datagrams and pushes them through the relay. */
    private fun pump(datagram: DatagramSocket) {
        val buffer = ByteArray(BUFFER)
        while (running && !datagram.isClosed) {
            val packet = DatagramPacket(buffer, buffer.size)
            val received = runCatching { datagram.receive(packet); true }.getOrDefault(false)
            if (!received) return
            gameAddress = packet.socketAddress as? InetSocketAddress ?: continue
            val sent = socket?.send(
                ByteString.of(*packet.data.copyOfRange(packet.offset, packet.offset + packet.length)),
            ) ?: return
            if (!sent) return
        }
    }
}
