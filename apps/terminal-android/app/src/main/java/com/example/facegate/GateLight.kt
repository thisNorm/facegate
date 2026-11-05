package com.example.facegate

import android.util.Log
import com.example.elcapi.jnielc
import org.json.JSONObject

/** 단말 외관 불빛. 대기, 통과, 불통 색은 서버 설정(관리자 웹 또는 단말 관리자)에서 정한다 */
object GateLight {
    // 제조사 데모 앱과 같은 값: 161 빨강, 162 초록, 163 파랑, 밝기 0~15
    private const val RED = 161
    private const val GREEN = 162
    private const val BLUE = 163
    private const val FULL = 15

    /** 서버 LIGHT_COLORS와 같은 이름. 이름 to (한글, 빨강, 초록, 파랑 켬) */
    val COLORS = linkedMapOf(
        "WHITE" to Color("하양", 0xFFFFFFFF, true, true, true),
        "GREEN" to Color("초록", 0xFF3ECF6E, false, true, false),
        "RED" to Color("빨강", 0xFFEF4444, true, false, false),
        "BLUE" to Color("파랑", 0xFF3B82F6, false, false, true),
        "YELLOW" to Color("노랑", 0xFFFACC15, true, true, false),
        "PURPLE" to Color("보라", 0xFFC026D3, true, false, true),
        "CYAN" to Color("하늘", 0xFF22D3EE, false, true, true),
        "OFF" to Color("끄기", 0xFF3A3B3F, false, false, false),
    )
    val STATES = listOf("idle" to "대기", "granted" to "통과", "denied" to "불통")

    class Color(val label: String, swatch: Long, val r: Boolean, val g: Boolean, val b: Boolean) {
        val swatch = swatch.toInt()
    }

    /** 지금 상태별 색 이름 */
    val chosen = mutableMapOf("idle" to "WHITE", "granted" to "GREEN", "denied" to "RED")
    private var current = "idle"

    fun idle() = show("idle")
    fun granted() = show("granted")
    fun denied() = show("denied")

    /** 서버의 불빛 설정(GET /light 응답 또는 light 메시지). 모르는 색은 무시하고 지금 상태를 다시 칠한다 */
    fun apply(json: JSONObject) {
        for ((state, _) in STATES) json.optString(state).takeIf { it in COLORS }?.let { chosen[state] = it }
        show(current)
    }

    private fun show(state: String) {
        current = state
        val c = COLORS.getValue(chosen.getValue(state))
        try {
            jnielc.seekstart()
            jnielc.ledseek(RED, if (c.r) FULL else 0)
            jnielc.ledseek(GREEN, if (c.g) FULL else 0)
            jnielc.ledseek(BLUE, if (c.b) FULL else 0)
            jnielc.seekstop()
        } catch (e: Throwable) {
            // 불빛 장치가 없는 단말(에뮬레이터 등)에서도 앱은 그대로 돌아야 한다
            Log.w("FaceGate", "gate light unavailable", e)
        }
    }
}
