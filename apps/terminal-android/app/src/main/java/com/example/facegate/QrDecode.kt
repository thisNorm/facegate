package com.example.facegate

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer

/**
 * 카메라 장면(ARGB 픽셀)에서 QR 글자를 찾는다. 안드로이드 없이 돌아서 단위 테스트로 확인한다.
 * 휴대폰 화면을 다시 찍은 QR은 반사·무늬로 뭉개지기 쉬워 여러 방법으로 본다.
 * 장면은 화면과 좌우가 뒤집혀 오므로(화면 오른쪽 사각형 = 장면 왼쪽) 반전본을 쓰고,
 * 장면 전체 다음에 사각형 쪽만 잘라 크게 본다. 밝게 날아간 화면용으로 판독 방식도 하나 더.
 */
class QrDecoder {
    private val reader = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true,
            ),
        )
    }

    @Synchronized
    fun decode(w: Int, h: Int, pixels: IntArray): String? {
        val mirrored = IntArray(w * h)
        for (y in 0 until h) for (x in 0 until w) mirrored[y * w + x] = pixels[y * w + (w - 1 - x)]
        val whole = RGBLuminanceSource(w, h, mirrored)
        val sight = whole.crop(w / 2, h / 8, w / 2, h * 3 / 4)
        return read(whole, hybrid = true)
            ?: read(sight, hybrid = true)
            ?: read(sight, hybrid = false)
            ?: read(RGBLuminanceSource(w, h, pixels), hybrid = true)
    }

    private fun read(source: LuminanceSource, hybrid: Boolean): String? = runCatching {
        val binarizer = if (hybrid) HybridBinarizer(source) else GlobalHistogramBinarizer(source)
        reader.decodeWithState(BinaryBitmap(binarizer)).text
    }.getOrNull().also { reader.reset() }
}
