package com.example.facegate

import org.json.JSONObject
import java.security.SecureRandom

/** 서버가 만들어 연결 순간 한 번만 넘기는 정보 (D-57). 서버 PairingInfo와 같은 필드 */
data class PairingInfo(
    val terminalKey: Int,
    val token: String,
    val gateKey: Int,
    val gateName: String,
    val rtspUser: String,
    val rtspPassword: String,
    val serverUrls: List<String>,
)

data class QrPayload(val code: String, val serverUrls: List<String>)

private val SIX_DIGITS = Regex("^\\d{6}$")
private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

/**
 * 관리자 웹 단말 추가 창의 QR: IGP1:<번호>:<포트>:<주소>/<주소>...
 * 영숫자 모드로 짧게 만들어 칸이 크다 (화면을 다시 찍어도 읽히게)
 */
fun parseQr(text: String): QrPayload? {
    val parts = text.trim().split(':')
    if (parts.size != 4 || parts[0] != "IGP1" || !SIX_DIGITS.matches(parts[1])) return null
    val port = parts[2].toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
    val hosts = parts[3].split('/').filter { IPV4.matches(it) }
    return if (hosts.isEmpty()) null else QrPayload(parts[1], hosts.map { "http://$it:$port" })
}

fun parsePairingInfo(json: String): PairingInfo? = runCatching {
    val o = JSONObject(json)
    val urls = o.getJSONArray("serverUrls").let { a -> List(a.length()) { a.getString(it) } }
    require(urls.isNotEmpty())
    PairingInfo(
        o.getInt("terminalKey"),
        o.getString("token"),
        o.getInt("gateKey"),
        o.getString("gateName"),
        o.getString("rtspUser"),
        o.getString("rtspPassword"),
        urls,
    )
}.getOrNull()

/** 서버 주소 후보 중 처음으로 답하는 곳. 망이 다르면 null */
fun pickServer(urls: List<String>, probe: (String) -> Boolean): String? = urls.firstOrNull(probe)

/** 단말 화면의 6자리 연결 번호. 화면 쪽 타이머로 10분마다, 또는 5번 틀리면 바뀐다 */
class PinBox(private val random: () -> Int = { SecureRandom().nextInt(1_000_000) }) {
    var pin: String = next()
        private set
    private var misses = 0

    private fun next() = random().toString().padStart(6, '0')

    @Synchronized
    fun rotate() {
        pin = next()
        misses = 0
    }

    @Synchronized
    fun check(candidate: String): Boolean {
        if (candidate == pin) return true
        if (++misses >= 5) rotate()
        return false
    }
}
