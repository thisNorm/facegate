package com.example.facegate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DecisionTest {
    private fun contract(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

    @Test
    fun parsesGrantedWithName() {
        val d = parseDecision(contract("decision-granted.json"))
        assertEquals(Decision("GRANTED", "홍길동", "개발팀"), d)
        val shown = displayOf(d!!)
        assertEquals(listOf("인증 완료", "홍길동", "개발팀"), listOf(shown.status, shown.title, shown.detail))
        assertEquals(NEXT_WAIT_MS, shown.millis)
    }

    @Test
    fun denialNeverShowsName() {
        val d = parseDecision(contract("decision-unregistered.json"))!!
        assertEquals("등록되지 않은 얼굴", displayOf(d).title)
        assertEquals("문을 열지 못했습니다", displayOf(Decision("GATE_ERROR", "홍길동", null)).title)
        assertEquals("출입 가능 시간이 아닙니다", displayOf(Decision("DENIED_TIME", "홍길동", null)).title)
        for (result in listOf("UNREGISTERED", "DENIED_GATE", "DENIED_TIME", "GATE_ERROR")) {
            val shown = displayOf(Decision(result, "홍길동", "개발팀"))
            assertEquals(false, "홍길동" in "${shown.title} ${shown.detail}")
        }
    }

    @Test
    fun ignoresOtherMessages() {
        assertNull(parseDecision("""{"type":"status"}"""))
        assertNull(parseDecision("not json"))
    }

    @Test
    fun lightMessageIsNotADecision() {
        val text = """{"type":"light","idle":"BLUE","granted":"GREEN","denied":"RED"}"""
        assertNull(parseDecision(text))
        assertEquals("BLUE", parseSetting(text)!!.getString("idle"))
        assertEquals("voice", parseSetting("""{"type":"voice","granted":"환영합니다"}""")!!.getString("type"))
        assertNull(parseSetting(contract("decision-granted.json")))
    }
}
