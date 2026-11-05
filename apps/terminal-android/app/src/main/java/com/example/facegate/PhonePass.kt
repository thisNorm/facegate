package com.example.facegate

import android.app.Activity
import android.app.Dialog
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlin.concurrent.thread

/**
 * 핸드폰으로 열기 (D-62). 서버에서 일회용 주소를 받아 NFC 태그(PassTag)에 넣고,
 * 버튼을 누르면 같은 주소를 QR로 크게 띄운다. 서버에서 이 기능을 끄면(404) 버튼을 숨긴다.
 */
class PhonePass(private val activity: Activity, private val api: TerminalApi, private val button: View) {
    private val handler = Handler(Looper.getMainLooper())
    private val poll = Runnable { refresh() }
    private val autoClose = Runnable { closeQr() }
    private var running = false
    private var dialog: Dialog? = null
    private var qrView: ImageView? = null
    private var shownUrl: String? = null

    init {
        button.setOnClickListener { showQr() }
    }

    fun start() {
        running = true
        refresh()
    }

    fun stop() {
        running = false
        handler.removeCallbacks(poll)
        PassTag.url = null
        button.visibility = View.GONE
        closeQr()
    }

    /** 새 값을 받는다. 서버가 값을 60초 동안 받으므로 20초마다, 그리고 판정이 오면 바로 (값은 한 번만 쓰임) */
    fun refresh() {
        handler.removeCallbacks(poll)
        thread {
            val r = api.send("GET", "/pass-code")
            val url = if (r.ok) runCatching { r.json().getString("url") }.getOrNull() else null
            handler.post {
                if (!running) return@post
                // 서버에 닿지 않을 때는 이전 값을 지운다. 지난 값을 내보내면 핸드폰에 "시간이 지났습니다"만 뜬다
                PassTag.url = url
                button.visibility = if (url != null) View.VISIBLE else View.GONE
                if (url == null) closeQr() else if (dialog != null) drawQr(url)
                handler.postDelayed(poll, REFRESH_MS)
            }
        }
    }

    /** 판정이 왔을 때. 통과하면 QR을 닫는다 */
    fun onDecision(granted: Boolean) {
        if (granted) closeQr()
        if (running) refresh()
    }

    private fun showQr() {
        val url = PassTag.url ?: return
        if (dialog != null) return
        val dp = activity.resources.displayMetrics.density
        fun label(value: String, size: Float, color: Int) = TextView(activity).apply {
            text = value
            textSize = size
            setTextColor(color)
            gravity = Gravity.CENTER
        }
        val qr = ImageView(activity).apply {
            layoutParams = LinearLayout.LayoutParams((440 * dp).toInt(), (440 * dp).toInt()).apply { topMargin = (20 * dp).toInt() }
        }
        val layout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xFF151619.toInt())
            addView(label("핸드폰 카메라로 비춰 주세요", 28f, Color.WHITE))
            addView(label("NFC가 켜진 핸드폰은 단말에 대기만 해도 됩니다", 18f, 0xD9FFFFFF.toInt()))
            addView(qr)
            addView(Button(activity).apply {
                text = "닫기"
                textSize = 20f
                setOnClickListener { closeQr() }
                layoutParams = LinearLayout.LayoutParams((200 * dp).toInt(), (64 * dp).toInt()).apply { topMargin = (24 * dp).toInt() }
            })
        }
        qrView = qr
        dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen).apply {
            setContentView(layout)
            setOnDismissListener { if (dialog === this) { dialog = null; qrView = null; shownUrl = null } }
            show()
        }
        drawQr(url)
        handler.removeCallbacks(autoClose)
        handler.postDelayed(autoClose, QR_SHOW_MS)
    }

    private fun drawQr(url: String) {
        if (url == shownUrl) return
        shownUrl = url
        qrView?.setImageBitmap(qrBitmap(url))
    }

    private fun closeQr() {
        handler.removeCallbacks(autoClose)
        dialog?.dismiss()
    }

    companion object {
        private const val REFRESH_MS = 20_000L
        private const val QR_SHOW_MS = 30_000L

        fun qrBitmap(text: String): Bitmap {
            val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.L, EncodeHintType.MARGIN to 4)
            val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
            val scale = 8
            val bitmap = Bitmap.createBitmap(matrix.width * scale, matrix.height * scale, Bitmap.Config.RGB_565)
            for (y in 0 until bitmap.height) for (x in 0 until bitmap.width)
                bitmap.setPixel(x, y, if (matrix[x / scale, y / scale]) Color.BLACK else Color.WHITE)
            return bitmap
        }
    }
}
