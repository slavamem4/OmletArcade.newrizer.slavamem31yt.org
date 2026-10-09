package com.newrizer.arcade.data

import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Minecraft hosting runs on the host's own network.
 *
 * There is no game server behind the app: the phone that hosts the world is
 * the server, so what players need is its address on the shared Wi-Fi (or on
 * the hotspot it is sharing). This resolves that address without any
 * permission - interface addresses are readable to the app itself.
 */
object Lan {

    /** Bedrock listens here by default; Java edition users override the port. */
    const val DEFAULT_PORT = 19132

    private val LOCAL_PREFIXES = listOf("192.168.", "10.", "172.")

    /** @return e.g. "192.168.1.42:19132", or null when offline. */
    fun address(port: Int = DEFAULT_PORT): String? = ipv4()?.let { "$it:$port" }

    fun ipv4(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces()
            .toList()
            .asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList().asSequence() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress.orEmpty() }
            .filter { candidate -> LOCAL_PREFIXES.any(candidate::startsWith) }
            .firstOrNull()
    }.getOrNull()
}
