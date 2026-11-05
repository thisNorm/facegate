package com.example.facegate

import android.os.Build
import com.example.facegate.streaming.StreamController
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

sealed interface PairResult {
    data class Ok(val info: PairingInfo) : PairResult
    /** INVALID, EXPIRED, USED, LOCKED */
    data class Refused(val error: String) : PairResult
    object Unreachable : PairResult
}

fun deviceJson(appVersion: String): JSONObject =
    JSONObject().put("model", Build.MODEL).put("appVersion", appVersion).put("rtspPort", StreamController.RTSP_PORT)

/** QR 연결 요청. 네트워크라 백그라운드 스레드에서만 호출 */
class PairingClient(base: OkHttpClient = OkHttpClient()) {
    private val quick = base.newBuilder().callTimeout(1500, TimeUnit.MILLISECONDS).build()
    private val normal = base.newBuilder().callTimeout(5, TimeUnit.SECONDS).build()

    fun hello(url: String): Boolean = runCatching {
        quick.newCall(Request.Builder().url("$url/api/terminal/hello").build()).execute().use {
            it.isSuccessful && JSONObject(it.body!!.string()).optString("app") == "FaceGate"
        }
    }.getOrDefault(false)

    fun pair(url: String, code: String, device: JSONObject): PairResult = runCatching {
        val body = JSONObject(device.toString()).put("code", code).toString()
            .toRequestBody("application/json".toMediaType())
        normal.newCall(Request.Builder().url("$url/api/terminal/pair").post(body).build()).execute().use {
            val text = it.body?.string().orEmpty()
            if (it.code == 200) {
                parsePairingInfo(text)?.let { info -> PairResult.Ok(info) } ?: PairResult.Unreachable
            } else {
                PairResult.Refused(runCatching { JSONObject(text).getString("error") }.getOrDefault("INVALID"))
            }
        }
    }.getOrDefault(PairResult.Unreachable)
}
