package com.example.facegate

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View

/** 가운데 얼굴 모형 틀(이마, 귀, 턱, 목). 틀 바깥은 어둡게 하고, 통과 결과가 오면 틀 색으로 잠깐 알린다 */
class FaceGuideView(context: Context, attrs: AttributeSet?) : View(context, attrs) {
    private val density = resources.displayMetrics.density
    private val shade = Paint().apply { color = 0x73000000 }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val face = Path()
    private val neck = Path()
    private val outside = Path().apply { fillType = Path.FillType.EVEN_ODD }
    private val reset = Runnable { idle() }

    init {
        idle()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val faceH = h * 0.7f
        val a = faceH * 0.36f // 얼굴 반폭 (귀 제외)
        val cx = w / 2f
        val top = h * 0.13f
        fun x(f: Float) = cx + a * f
        fun y(f: Float) = top + faceH * f

        face.reset()
        face.moveTo(x(0f), y(0f))
        // 오른쪽: 정수리 → 관자놀이 → 귀 → 볼 → 턱
        face.cubicTo(x(0.58f), y(0f), x(1f), y(0.13f), x(1f), y(0.40f))
        face.cubicTo(x(1.13f), y(0.35f), x(1.2f), y(0.50f), x(0.98f), y(0.60f))
        face.cubicTo(x(0.94f), y(0.78f), x(0.66f), y(0.94f), x(0.3f), y(0.99f))
        face.cubicTo(x(0.12f), y(1.01f), x(-0.12f), y(1.01f), x(-0.3f), y(0.99f))
        // 왼쪽은 거꾸로
        face.cubicTo(x(-0.66f), y(0.94f), x(-0.94f), y(0.78f), x(-0.98f), y(0.60f))
        face.cubicTo(x(-1.2f), y(0.50f), x(-1.13f), y(0.35f), x(-1f), y(0.40f))
        face.cubicTo(x(-1f), y(0.13f), x(-0.58f), y(0f), x(0f), y(0f))
        face.close()

        neck.reset()
        neck.moveTo(x(-0.5f), y(0.955f))
        neck.lineTo(x(-0.5f), y(1.12f))
        neck.moveTo(x(0.5f), y(0.955f))
        neck.lineTo(x(0.5f), y(1.12f))

        outside.reset()
        outside.addRect(0f, 0f, w.toFloat(), h.toFloat(), Path.Direction.CW)
        outside.addPath(face)
    }

    /** 통과면 초록, 거부면 빨강 같은 색으로 틀을 굵게 칠했다가 되돌린다 */
    fun flash(color: Int, millis: Long) {
        line.color = color
        line.strokeWidth = 6 * density
        invalidate()
        removeCallbacks(reset)
        postDelayed(reset, millis)
    }

    private fun idle() {
        line.color = 0xD9FFFFFF.toInt()
        line.strokeWidth = 3 * density
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawPath(outside, shade)
        canvas.drawPath(face, line)
        canvas.drawPath(neck, line)
    }
}
