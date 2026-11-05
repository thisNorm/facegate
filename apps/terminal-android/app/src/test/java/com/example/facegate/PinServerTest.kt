package com.example.facegate

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class PinServerTest {
    private fun post(port: Int, path: String, body: String): Pair<Int, String> {
        val c = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toByteArray()) }
        val stream = if (c.responseCode < 400) c.inputStream else c.errorStream
        return c.responseCode to (stream?.bufferedReader()?.readText().orEmpty())
    }

    private val info =
        """"terminalKey":103,"token":"t","gateKey":1,"gateName":"정문","rtspUser":"gate103","rtspPassword":"p","serverUrls":["http://127.0.0.1:8080"]"""

    @Test
    fun acceptsTheRightPinOnly() {
        val paired = mutableListOf<PairingInfo>()
        val device = { JSONObject().put("model", "WF1589T").put("appVersion", "0.1.0").put("rtspPort", 8555) }
        val server = PinServer(0, PinBox { 482913 }, device) { paired += it }
        server.start()
        try {
            assertEquals(401, post(server.boundPort, "/pair", """{"pin":"000000",$info}""").first)
            assertEquals(0, paired.size)
            assertEquals(404, post(server.boundPort, "/other", """{"pin":"482913",$info}""").first)
            assertEquals(400, post(server.boundPort, "/pair", """{"pin":"482913"}""").first)
            val (code, text) = post(server.boundPort, "/pair", """{"pin":"482913",$info}""")
            assertEquals(200, code)
            assertEquals(8555, JSONObject(text).getInt("rtspPort"))
            assertEquals(103, paired.single().terminalKey)
        } finally {
            server.stop()
        }
    }
}
