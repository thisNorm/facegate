package com.example.facegate

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** 핸드폰이 NDEF 태그를 읽는 순서 그대로 (NFC Forum Type 4 Tag) */
class PassTagTest {
    private fun hex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun ByteArray.hex() = joinToString("") { "%02X".format(it) }
    private val url = "https://gate.example.co.kr:8443/m/pass?c=AbC-123_x"

    @Test
    fun aPhoneReadsTheUrlThroughSelectAndReadBinary() {
        val s = PassTag.Session()
        assertEquals("9000", s.respond(hex("00A4040007D276000085010100"), url).hex())
        assertEquals("9000", s.respond(hex("00A4000C02E103"), url).hex())
        assertEquals("000F2000FF00FF0406E104080000FF9000", s.respond(hex("00B000000F"), url).hex())
        assertEquals("9000", s.respond(hex("00A4000C02E104"), url).hex())
        val nlen = s.respond(hex("00B0000002"), url)
        val length = ((nlen[0].toInt() and 0xFF) shl 8) or (nlen[1].toInt() and 0xFF)
        // 주소가 읽는 사이 바뀌어도 이번에 댄 동안은 처음 값
        val body = s.respond(byteArrayOf(0, 0xB0.toByte(), 0, 2, length.toByte()), "https://other/")
        assertEquals("9000", body.copyOfRange(body.size - 2, body.size).hex())
        val message = body.copyOfRange(0, body.size - 2)
        assertArrayEquals(PassTag.ndefMessage(url), message)
        // URI 레코드: 짧은 레코드 한 개, 형식 U, 접두 04 = https://
        assertEquals("D101", message.copyOfRange(0, 2).hex())
        assertEquals('U'.code.toByte(), message[3])
        assertEquals(0x04.toByte(), message[4])
        assertEquals(url.removePrefix("https://"), String(message.copyOfRange(5, message.size), Charsets.UTF_8))
    }

    @Test
    fun noUrlMeansNoTagAndFilesNeedTheTagSelectedFirst() {
        val s = PassTag.Session()
        assertEquals("6A82", s.respond(hex("00A4000C02E104"), url).hex())
        assertEquals("6A82", s.respond(hex("00A4040007D276000085010100"), null).hex())
        assertEquals("6A82", s.respond(hex("00B0000002"), url).hex())
        assertEquals("6A86", s.respond(hex("80CA9F7F00"), url).hex())
        // 아이폰처럼 P2=00으로 골라도 된다
        assertEquals("9000", s.respond(hex("00A4040007D2760000850101"), url).hex())
        assertEquals("9000", s.respond(hex("00A4000002E103"), url).hex())
    }
}
