package com.example.facegate

import android.graphics.Bitmap
import android.util.Base64
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/** 화면 장면 → 서버가 받는 JPEG data URL. 긴 변 1280으로 줄인다 */
fun jpegDataUrl(bitmap: Bitmap): String {
    val scale = 1280f / maxOf(bitmap.width, bitmap.height)
    val small = if (scale < 1) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
    val out = ByteArrayOutputStream()
    small.compress(Bitmap.CompressFormat.JPEG, 90, out)
    return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/** 단말 API (/api/terminal). 네트워크라 백그라운드 스레드에서만 호출 */
class TerminalApi(private val settings: TerminalSettings, base: OkHttpClient = OkHttpClient()) {
    /** code 0 = 서버에 닿지 못함 */
    class Reply(val code: Int, val text: String) {
        val ok get() = code in 200..299
        fun json() = JSONObject(text)
        val error get() = runCatching { JSONObject(text).getString("error") }.getOrDefault("")
    }

    private val client = base.newBuilder().callTimeout(15, TimeUnit.SECONDS).build()

    /** 관리자 모드 세션 (D-58). 나가면 지운다 */
    @Volatile var adminToken: String? = null

    private fun request(path: String) = Request.Builder()
        .url("${settings.serverUrl}/api/terminal$path")
        .header("Authorization", "Bearer ${settings.token}")
        .apply { adminToken?.let { header("X-Terminal-Admin-Token", it) } }

    fun send(method: String, path: String, body: JSONObject? = null): Reply = runCatching {
        val payload = body?.toString()?.toRequestBody(JSON)
            ?: if (method == "POST" || method == "PATCH") "{}".toRequestBody(JSON) else null
        client.newCall(request(path).method(method, payload).build()).execute().use {
            Reply(it.code, it.body?.string().orEmpty())
        }
    }.getOrDefault(Reply(0, ""))

    fun bytes(path: String): ByteArray? = runCatching {
        client.newCall(request(path).build()).execute().use { if (it.isSuccessful) it.body?.bytes() else null }
    }.getOrNull()

    companion object {
        private val JSON = "application/json".toMediaType()
    }
}
