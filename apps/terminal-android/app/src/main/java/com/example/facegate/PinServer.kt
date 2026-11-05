package com.example.facegate

import org.json.JSONObject
import java.io.BufferedInputStream
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

const val PIN_PORT = 8556

/**
 * 미연결일 때만 여는 번호 창구 (D-57). 관리자가 웹에 이 단말의 주소와 화면 번호를 넣으면
 * 서버가 POST /pair 로 번호와 연결 정보를 보낸다. 번호가 맞을 때만 받는다.
 */
class PinServer(
    private val port: Int,
    private val pins: PinBox,
    private val device: () -> JSONObject,
    private val onPaired: (PairingInfo) -> Unit,
) {
    @Volatile private var socket: ServerSocket? = null
    val boundPort get() = socket?.localPort ?: port

    fun start() {
        if (socket != null) return
        val server = ServerSocket(port)
        socket = server
        thread(isDaemon = true, name = "pin-server") {
            while (!server.isClosed) {
                val client = runCatching { server.accept() }.getOrNull() ?: break
                runCatching { client.use { handle(it) } }
            }
        }
    }

    fun stop() {
        socket?.close()
        socket = null
    }

    private fun handle(client: Socket) {
        client.soTimeout = 5000
        val input = BufferedInputStream(client.getInputStream())
        val head = StringBuilder()
        while (!head.endsWith("\r\n\r\n")) {
            val b = input.read()
            if (b < 0 || head.length > 8192) return
            head.append(b.toChar())
        }
        val lines = head.lines()
        if (!lines[0].startsWith("POST /pair ")) return reply(client, 404, "{}")
        val length = lines.firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
            ?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0
        if (length !in 1..65536) return reply(client, 400, "{}")
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) return
            read += n
        }
        val text = String(body, Charsets.UTF_8)
        val pin = runCatching { JSONObject(text).getString("pin") }.getOrNull()
        val info = parsePairingInfo(text)
        if (pin == null || info == null) return reply(client, 400, "{}")
        if (!pins.check(pin)) return reply(client, 401, "{}")
        onPaired(info)
        reply(client, 200, device().toString())
    }

    private fun reply(client: Socket, status: Int, json: String) {
        val bytes = json.toByteArray(Charsets.UTF_8)
        val reason = mapOf(200 to "OK", 400 to "Bad Request", 401 to "Unauthorized", 404 to "Not Found")[status]
        client.getOutputStream().apply {
            write(
                "HTTP/1.1 $status $reason\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                    .toByteArray(),
            )
            write(bytes)
            flush()
        }
    }
}
