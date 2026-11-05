package com.example.facegate

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 서버가 이 단말 연결을 해제했는지: 업그레이드 401(토큰 폐기) 또는 닫기 코드 4401 (D-57) */
fun isUnpaired(httpCode: Int?, closeCode: Int?): Boolean = httpCode == 401 || closeCode == 4401

/** 서버가 보내는 단말 설정 메시지 (type light: 불빛 색, voice: 음성 안내 문구) */
fun parseSetting(text: String): JSONObject? = try {
    JSONObject(text).takeIf { it.optString("type") in setOf("light", "voice") }
} catch (_: Exception) { null }

// connect()/close()는 메인 스레드에서 호출. 콜백은 메인 스레드로 넘긴 뒤 현재 소켓인지 확인한다.
class TerminalSocket(
    private val settings: TerminalSettings,
    private val onDecision: (Decision) -> Unit,
    /** 불빛 색, 음성 안내 설정이 바뀜 (type light, voice) */
    private val onSetting: (JSONObject) -> Unit,
    private val onConnected: (Boolean) -> Unit,
    private val onUnpaired: () -> Unit,
) {
    private val client = OkHttpClient.Builder().pingInterval(30, TimeUnit.SECONDS).build()
    private val handler = Handler(Looper.getMainLooper())
    private var socket: WebSocket? = null
    private var backoffMs = 1000L
    private var closed = false

    fun connect() {
        closed = false
        handler.removeCallbacksAndMessages(null) // 대기 중인 재연결 취소
        val request = try {
            Request.Builder()
                .url("${settings.serverUrl.replaceFirst("http", "ws")}/ws/terminal?gate_key=${settings.gateKey}")
                .header("Authorization", "Bearer ${settings.token}")
                // 서버가 영상을 받을 수 있는 주소를 고를 때 쓴다 (공유기 너머면 접속 주소로는 못 받음)
                .header("X-Terminal-Addresses", localIpv4s().joinToString(","))
                .build()
        } catch (_: IllegalArgumentException) {
            onConnected(false) // 잘못된 서버 주소. 설정을 고칠 때까지 재시도하지 않음
            return
        }
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                handler.post { if (ws === socket) { backoffMs = 1000; onConnected(true) } }
            }

            override fun onMessage(ws: WebSocket, text: String) {
                parseDecision(text)?.let { d -> handler.post { if (ws === socket) onDecision(d) } }
                parseSetting(text)?.let { m -> handler.post { if (ws === socket) onSetting(m) } }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(1000, null) // 서버가 닫으면 응답해야 onClosed가 오고 재연결함
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                handler.post { if (ws === socket) ended(isUnpaired(null, code)) }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                val unpaired = isUnpaired(response?.code, null)
                handler.post { if (ws === socket) ended(unpaired) }
            }
        })
    }

    private fun ended(unpaired: Boolean) {
        if (!unpaired) return retry()
        closed = true
        onConnected(false)
        onUnpaired() // 재연결하지 않는다. 미연결 화면으로
    }

    private fun retry() {
        onConnected(false)
        if (closed) return
        handler.postDelayed({ if (!closed) connect() }, backoffMs)
        backoffMs = minOf(backoffMs * 2, 30_000)
    }

    fun close() {
        closed = true
        handler.removeCallbacksAndMessages(null)
        socket?.close(1000, null)
    }
}
