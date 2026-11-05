package com.example.facegate

import android.content.Context

/** 서버가 연결 순간 넘겨준 정보 (D-57). 사람이 입력하지 않는다 */
class TerminalSettings(context: Context) {
    private val prefs = context.getSharedPreferences("terminal", Context.MODE_PRIVATE)

    val serverUrl get() = prefs.getString("serverUrl", "") ?: ""
    val gateKey get() = prefs.getInt("gateKey", 0)
    val gateName get() = prefs.getString("gateName", "") ?: ""
    val terminalKey get() = prefs.getInt("terminalKey", 0)
    val token get() = prefs.getString("token", "") ?: ""
    val rtspUser get() = prefs.getString("rtspUser", "") ?: ""
    val rtspPassword get() = prefs.getString("rtspPassword", "") ?: ""
    val isPaired get() = serverUrl.isNotBlank() && token.isNotBlank() && rtspPassword.isNotBlank()

    fun save(info: PairingInfo, serverUrl: String) {
        prefs.edit()
            .putString("serverUrl", serverUrl.trimEnd('/'))
            .putInt("gateKey", info.gateKey)
            .putString("gateName", info.gateName)
            .putInt("terminalKey", info.terminalKey)
            .putString("token", info.token)
            .putString("rtspUser", info.rtspUser)
            .putString("rtspPassword", info.rtspPassword)
            .commit()
    }

    fun clear() {
        prefs.edit().clear().commit()
    }
}
