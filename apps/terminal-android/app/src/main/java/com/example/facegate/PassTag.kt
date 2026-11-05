package com.example.facegate

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * 핸드폰으로 열기 (D-62). 단말이 NFC 태그(NFC Forum Type 4, NDEF)인 척하고 서버가 준 일회용 주소를 담는다.
 * 핸드폰이 대면 기본 NFC 기능으로 읽어 브라우저로 연다. 앱이 필요 없다.
 */
object PassTag {
    /** 지금 내보낼 주소. 없으면 태그로 응답하지 않는다 (PhonePass가 바꾼다) */
    @Volatile var url: String? = null

    private val NDEF_AID = hex("D2760000850101")
    private val CC_FILE = hex("E103")
    private val NDEF_FILE = hex("E104")
    private val OK = hex("9000")
    private val NOT_FOUND = hex("6A82")
    private val WRONG = hex("6A86")

    /** 기능 목록(CC): 읽기 전용, NDEF 파일 E104 최대 2KB */
    private val CC = hex("000F2000FF00FF0406E104080000FF")

    /** 주소 하나짜리 NDEF 메시지 (URI 레코드). 짧은 레코드라 255바이트까지 */
    fun ndefMessage(url: String): ByteArray {
        val (prefix, rest) = when {
            url.startsWith("https://") -> 0x04 to url.removePrefix("https://")
            url.startsWith("http://") -> 0x03 to url.removePrefix("http://")
            else -> 0x00 to url
        }
        val payload = byteArrayOf(prefix.toByte()) + rest.toByteArray(Charsets.UTF_8)
        require(payload.size <= 255) { "url too long for a short record" }
        return byteArrayOf(0xD1.toByte(), 0x01, payload.size.toByte(), 'U'.code.toByte()) + payload
    }

    /** 한 번 대는 동안의 응답. 핸드폰이 고른 파일을 기억한다 */
    class Session {
        private var file: ByteArray? = null
        private var ndef: ByteArray? = null

        fun respond(apdu: ByteArray, currentUrl: String?): ByteArray {
            if (apdu.size < 4 || apdu[0] != 0.toByte()) return WRONG
            val ins = apdu[1].toInt() and 0xFF
            val p1 = apdu[2].toInt() and 0xFF
            return when (ins) {
                0xA4 -> select(apdu, p1, currentUrl)
                0xB0 -> read(apdu, p1)
                else -> WRONG
            }
        }

        private fun select(apdu: ByteArray, p1: Int, currentUrl: String?): ByteArray {
            if (apdu.size < 5) return WRONG
            val length = apdu[4].toInt() and 0xFF
            if (apdu.size < 5 + length) return WRONG
            val data = apdu.copyOfRange(5, 5 + length)
            return when {
                p1 == 0x04 && data.contentEquals(NDEF_AID) -> {
                    // 고른 순간의 주소로 고정한다. 읽는 사이 주소가 바뀌어도 한 번 대는 동안은 같은 값
                    val url = currentUrl ?: return NOT_FOUND
                    val message = ndefMessage(url)
                    ndef = byteArrayOf((message.size shr 8).toByte(), message.size.toByte()) + message
                    file = null
                    OK
                }
                p1 == 0x00 && data.contentEquals(CC_FILE) && ndef != null -> { file = CC; OK }
                p1 == 0x00 && data.contentEquals(NDEF_FILE) && ndef != null -> { file = ndef; OK }
                else -> NOT_FOUND
            }
        }

        private fun read(apdu: ByteArray, p1: Int): ByteArray {
            val current = file ?: return NOT_FOUND
            val offset = (p1 shl 8) or (apdu[3].toInt() and 0xFF)
            if (offset > current.size) return WRONG
            val wanted = if (apdu.size >= 5) (apdu[4].toInt() and 0xFF).let { if (it == 0) 256 else it } else 256
            return current.copyOfRange(offset, minOf(current.size, offset + wanted)) + OK
        }
    }

    private fun hex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}

/** 안드로이드가 단말에 댄 NFC 리더(핸드폰)의 명령을 넘겨준다. 등록은 AndroidManifest, res/xml/pass_tag.xml */
class PassTagService : HostApduService() {
    private var session = PassTag.Session()

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray = session.respond(apdu, PassTag.url)

    override fun onDeactivated(reason: Int) {
        session = PassTag.Session()
    }
}
