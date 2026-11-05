package com.example.facegate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTest {
    @Test
    fun parsesQrWithServerCandidates() {
        val qr = parseQr("IGP1:482913:18080:192.168.0.191/127.0.0.1")
        assertEquals(QrPayload("482913", listOf("http://192.168.0.191:18080", "http://127.0.0.1:18080")), qr)
    }

    @Test
    fun rejectsOtherQrCodes() {
        assertNull(parseQr("https://example.com"))
        assertNull(parseQr("IGP1:12:18080:192.168.0.191"))
        assertNull(parseQr("IGP1:482913:0:192.168.0.191"))
        assertNull(parseQr("IGP1:482913:18080:"))
        assertNull(parseQr("IGP1:482913:18080:evil.example"))
        assertNull(parseQr("IGP2:482913:18080:192.168.0.191"))
    }

    @Test
    fun picksFirstReachableServer() {
        val tried = mutableListOf<String>()
        val url = pickServer(listOf("http://a", "http://b", "http://c")) { tried += it; it == "http://b" }
        assertEquals("http://b", url)
        assertEquals(listOf("http://a", "http://b"), tried)
        assertNull(pickServer(listOf("http://a")) { false })
    }

    @Test
    fun parsesPairingInfo() {
        val info = parsePairingInfo(
            """{"terminalKey":103,"token":"t","gateKey":1,"gateName":"정문","rtspUser":"gate103","rtspPassword":"p","serverUrls":["http://127.0.0.1:8080"]}""",
        )
        assertEquals(PairingInfo(103, "t", 1, "정문", "gate103", "p", listOf("http://127.0.0.1:8080")), info)
        assertNull(parsePairingInfo("""{"terminalKey":103}"""))
        assertNull(parsePairingInfo("""{"terminalKey":103,"token":"t","gateKey":1,"gateName":"정문","rtspUser":"u","rtspPassword":"p","serverUrls":[]}"""))
    }

    @Test
    fun pinRotatesAfterFiveMisses() {
        var n = 0
        val box = PinBox { n++ }
        assertEquals("000000", box.pin)
        repeat(4) { assertFalse(box.check("999999")) }
        assertEquals("000000", box.pin)
        assertFalse(box.check("999999"))
        assertEquals("000001", box.pin)
        assertTrue(box.check("000001"))
        assertEquals("000 001", spacedPin(box.pin))
    }

    @Test
    fun unpairedOnlyOn401Or4401() {
        assertTrue(isUnpaired(401, null))
        assertTrue(isUnpaired(null, 4401))
        assertFalse(isUnpaired(null, 1000))
        assertFalse(isUnpaired(502, null))
        assertFalse(isUnpaired(null, null))
    }
}
