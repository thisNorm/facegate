package com.example.facegate

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.Assert.assertEquals
import org.junit.Test

class QrDecodeTest {
    private val text = "IGP1:482913:18080:192.168.0.191/192.168.112.1/100.118.159.111/127.0.0.1"

    /** 1920x1080 회색 장면 안에 QR을 모듈당 px 크기로 그린다. 장면은 화면과 좌우가 뒤집혀 오므로 mirror */
    private fun frame(modulePx: Int, left: Int, top: Int, mirror: Boolean): IntArray {
        val w = 1920
        val h = 1080
        val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.L, EncodeHintType.MARGIN to 4)
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
        val pixels = IntArray(w * h) { 0xFF808080.toInt() }
        for (my in 0 until matrix.height) for (mx in 0 until matrix.width) {
            val color = if (matrix.get(mx, my)) 0xFF101010.toInt() else 0xFFF0F0F0.toInt()
            for (dy in 0 until modulePx) for (dx in 0 until modulePx) {
                val x = left + mx * modulePx + dx
                val y = top + my * modulePx + dy
                val px = if (mirror) w - 1 - x else x
                pixels[y * w + px] = color
            }
        }
        return pixels
    }

    @Test
    fun readsAMirroredQrOnTheRightOfTheScreen() {
        assertEquals(text, QrDecoder().decode(1920, 1080, frame(6, 1300, 300, mirror = true)))
    }

    @Test
    fun readsANormalQr() {
        assertEquals(text, QrDecoder().decode(1920, 1080, frame(6, 300, 300, mirror = false)))
    }

    @Test
    fun readsASmallQr() {
        assertEquals(text, QrDecoder().decode(1920, 1080, frame(3, 1400, 400, mirror = true)))
    }
}
