package com.example.facegate

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.example.facegate.streaming.StreamController
import java.util.concurrent.Executors

/**
 * 미리보기 장면을 0.5초마다 한 장씩 받아 QR을 찾는다. 찾으면 멈추고 알린다.
 * 장면 콜백은 화면을 그리는 GL 스레드라 해석은 따로 돌려 미리보기가 멈칫하지 않게 한다.
 */
class QrScanner(private val stream: StreamController, private val onFound: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val decoder = QrDecoder()
    private var running = false
    private var frames = 0
    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            stream.snapshot { bitmap -> worker.execute { handle(bitmap) } }
        }
    }

    private fun handle(bitmap: Bitmap) {
        val text = decode(bitmap)
        main.post {
            if (!running) return@post
            if (text != null) {
                running = false
                onFound(text)
            } else {
                main.postDelayed(tick, 500)
            }
        }
    }

    fun start() {
        if (running) return
        running = true
        main.postDelayed(tick, 500)
    }

    fun stop() {
        running = false
        main.removeCallbacks(tick)
    }

    /**
     * 휴대폰 화면을 다시 찍은 QR은 반사·무늬로 뭉개지기 쉬워 여러 방법으로 본다.
     * 장면은 화면과 좌우가 뒤집혀 오므로(화면 오른쪽 사각형 = 장면 왼쪽) 반전본을 쓰고,
     * 장면 전체 다음에 사각형 쪽만 잘라 크게 본다. 밝게 날아간 화면용으로 판독 방식도 하나 더.
     */
    private fun decode(full: Bitmap): String? {
        val w = full.width
        val h = full.height
        val pixels = IntArray(w * h).also { full.getPixels(it, 0, w, 0, 0, w, h) }
        val text = decoder.decode(w, h, pixels)
        if (++frames % 40 == 1) Log.d("FaceGate", "qr scan ${w}x$h #$frames found=${text != null}")
        return text
    }

}
