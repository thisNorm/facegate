package com.example.facegate

import org.json.JSONObject

data class Decision(val result: String, val name: String?, val department: String?)

enum class ResultIcon { CHECK, CROSS, WARNING }

/** 판정 카드 내용. 카메라 화면 위 아래쪽 카드로 띄운다 (출입 단말들처럼 화면 전체를 덮지 않음) */
data class Display(
    val icon: ResultIcon,
    /** "인증 완료" 같은 한 줄 상태 */
    val status: String,
    /** 이름, 또는 실패 사유 */
    val title: String,
    val detail: String?,
    val color: Int,
    val millis: Long = NEXT_WAIT_MS,
)

/** 한 사람을 인증한 뒤 다음 인증까지 기다리는 시간. AI 설정 WAIT_TIME_SEC(3초)와 맞춘다 */
const val NEXT_WAIT_MS = 3000L

const val GRANTED_COLOR = 0xFF22A355.toInt()
const val DENIED_COLOR = 0xFFE5484D.toInt()
const val ERROR_COLOR = 0xFFF5A524.toInt()

fun parseDecision(text: String): Decision? = try {
    val json = JSONObject(text)
    if (json.optString("type") != "decision") null
    else Decision(json.getString("result"), json.optString("name").ifEmpty { null }, json.optString("department").ifEmpty { null })
} catch (_: Exception) { null }

// 05 문서 T-02/T-03. 거부 화면에는 이름을 넣지 않는다.
fun displayOf(d: Decision): Display = when (d.result) {
    "GRANTED" -> Display(ResultIcon.CHECK, "인증 완료", d.name ?: "확인되었습니다", d.department ?: "환영합니다", GRANTED_COLOR)
    "UNREGISTERED" -> Display(ResultIcon.CROSS, "인증 실패", "등록되지 않은 얼굴", "방문객은 호출 버튼을 눌러 주세요", DENIED_COLOR)
    "GATE_ERROR" -> Display(ResultIcon.WARNING, "게이트 오류", "문을 열지 못했습니다", "잠시 후 다시 시도하세요", ERROR_COLOR)
    "DENIED_TIME" -> Display(ResultIcon.CROSS, "인증 실패", "출입 가능 시간이 아닙니다", "관리자에게 문의하세요", DENIED_COLOR)
    else -> Display(ResultIcon.CROSS, "인증 실패", "출입 권한이 없습니다", "관리자에게 문의하세요", DENIED_COLOR)
}
