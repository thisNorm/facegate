package com.pedro.rtspserver.server

import com.pedro.rtsp.rtsp.commands.Method
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class ServerCommandManagerTest {
    private val manager = ServerCommandManager().apply { setAuth("user", "pass") }
    private val setup = "SETUP rtsp://10.0.0.2:8554/streamid=0 RTSP/1.0\r\nCSeq: 3\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n"
    private val goodAuth = "Authorization: Basic ${Base64.getEncoder().encodeToString("user:pass".toByteArray())}\r\n"

    private fun status(method: Method, request: String) = manager.createResponse(method, request, 3, "10.0.0.9").lineSequence().first()

    @Test
    fun setupAndPlayWithoutAuthAreRejected() {
        assertTrue(status(Method.SETUP, setup).contains("401"))
        assertTrue(status(Method.PLAY, "PLAY rtsp://10.0.0.2:8554/ RTSP/1.0\r\nCSeq: 4\r\n").contains("401"))
        assertTrue(status(Method.TEARDOWN, "TEARDOWN rtsp://10.0.0.2:8554/ RTSP/1.0\r\n").contains("401"))
    }

    @Test
    fun wrongPasswordIsRejected() {
        val bad = "Authorization: Basic ${Base64.getEncoder().encodeToString("user:nope".toByteArray())}\r\n"
        assertTrue(status(Method.SETUP, setup + bad).contains("401"))
    }

    @Test
    fun optionsNeedsNoAuth() {
        assertTrue(status(Method.OPTIONS, "OPTIONS rtsp://10.0.0.2:8554/ RTSP/1.0\r\n").contains("200"))
    }

    @Test
    fun setupAndPlayWithAuthAreAccepted() {
        assertTrue(status(Method.SETUP, setup + goodAuth).contains("200"))
        assertTrue(status(Method.PLAY, "PLAY rtsp://10.0.0.2:8554/ RTSP/1.0\r\n$goodAuth").contains("200"))
    }

    @Test
    fun udpSetupIsRejectedSoClientFallsBackToTcp() {
        val udp = "SETUP rtsp://10.0.0.2:8554/streamid=0 RTSP/1.0\r\nCSeq: 3\r\nTransport: RTP/AVP;unicast;client_port=5000-5001\r\n"
        assertTrue(status(Method.SETUP, udp + goodAuth).contains("461"))
    }
}
