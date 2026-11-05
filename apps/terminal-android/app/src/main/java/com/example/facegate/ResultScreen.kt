package com.example.facegate

import android.content.res.ColorStateList
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.ImageView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 카메라 화면 아래쪽에 띄우는 판정 카드 (view_result.xml) */
class ResultScreen(private val root: View) {
    private val card = root.findViewById<View>(R.id.result_card)
    private val badge = root.findViewById<View>(R.id.result_badge)
    private val icon = root.findViewById<ImageView>(R.id.result_icon)
    private val status = root.findViewById<TextView>(R.id.result_status)
    private val title = root.findViewById<TextView>(R.id.result_title)
    private val detail = root.findViewById<TextView>(R.id.result_detail)
    private val time = root.findViewById<TextView>(R.id.result_time)
    private val wait = root.findViewById<TextView>(R.id.result_wait)
    private var waitUntil = 0L
    private val tick = object : Runnable {
        override fun run() {
            val left = ((waitUntil - System.currentTimeMillis() + 999) / 1000).coerceAtLeast(0)
            wait.text = if (left > 0) "${left}초 후 다음 인증" else ""
            if (left > 0) wait.postDelayed(this, 200)
        }
    }
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.KOREA)

    fun show(d: Display) {
        badge.backgroundTintList = ColorStateList.valueOf(d.color)
        icon.setImageResource(
            when (d.icon) {
                ResultIcon.CHECK -> R.drawable.ic_check
                ResultIcon.CROSS -> R.drawable.ic_cross
                ResultIcon.WARNING -> R.drawable.ic_warning
            },
        )
        status.text = d.status
        status.setTextColor(d.color)
        title.text = d.title
        detail.text = d.detail
        detail.visibility = if (d.detail == null) View.GONE else View.VISIBLE
        time.text = clock.format(Date())
        waitUntil = System.currentTimeMillis() + d.millis
        wait.removeCallbacks(tick)
        tick.run()
        root.visibility = View.VISIBLE

        // 카드는 아래에서 살짝 올라오고 아이콘은 톡 튀어나온다
        val rise = 24 * root.resources.displayMetrics.density
        card.animate().cancel()
        card.alpha = 0f
        card.translationY = rise
        card.animate().alpha(1f).translationY(0f).setDuration(180).setInterpolator(DecelerateInterpolator()).start()
        badge.animate().cancel()
        badge.scaleX = 0.6f
        badge.scaleY = 0.6f
        badge.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(2.5f)).start()
    }

    fun hide() {
        wait.removeCallbacks(tick)
        root.visibility = View.GONE
    }
}
