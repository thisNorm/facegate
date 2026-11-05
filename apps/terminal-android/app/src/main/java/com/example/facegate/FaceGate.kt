package com.example.facegate

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.example.facegate.face.FaceRecognizer
import com.example.facegate.face.FaceResult
import com.example.facegate.face.ScrfdLvFaceRecognizer
import com.example.facegate.streaming.StreamController
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * 단말 안 얼굴 인식 (D-63). 서버 설정이 '단말'일 때만 돈다.
 * 1분마다 등록 사진 목록을 보고 바뀌었으면 다시 받는다. 0.5초마다 장면 한 장을 인식해
 * 단말 앞에 선 사람이 정해지면 서버에 appear로 한 번 보낸다. 문을 여는 판단은 서버가 한다.
 * 모델과 인식은 작업 스레드 하나에서만 다룬다.
 */
class FaceGate(private val context: Context, private val stream: StreamController, private val api: TerminalApi) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var running = false

    // 여기부터 작업 스레드에서만
    private var enabled = false
    private var recognizer: FaceRecognizer? = null
    private var galleryPaths: List<String>? = null
    private var syncedAt = 0L
    /** 지금 단말 앞 사람으로 이미 보낸 것 (직원 번호 또는 "u"). 얼굴이 사라지면 지운다 */
    private var sentKey: String? = null
    private var seenAt = 0L
    private var nextTrack = 1
    private val clock = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA).apply { timeZone = TimeZone.getTimeZone("Asia/Seoul") }

    fun start() {
        if (running) return
        running = true
        main.post(tick)
    }

    fun stop() {
        running = false
        main.removeCallbacks(tick)
    }

    fun close() {
        stop()
        worker.execute { recognizer?.close(); recognizer = null }
        worker.shutdown()
    }

    private val tick: Runnable = Runnable {
        if (!running) return@Runnable
        worker.execute {
            runCatching { sync() }.onFailure { Log.w(TAG, "face sync", it) }
            main.post {
                if (!running) return@post
                // 송출 중이 아니면 장면이 오지 않는다 (콜백이 안 불림). 다음 차례에 다시 본다
                if (enabled && recognizer != null && stream.isStreaming()) {
                    stream.snapshot { frame -> worker.execute { handle(frame) } }
                } else {
                    main.postDelayed(tick, IDLE_MS)
                }
            }
        }
    }

    private fun handle(frame: Bitmap) {
        val result = runCatching { recognizer?.recognize(frame) }.onFailure { Log.w(TAG, "recognize", it) }.getOrNull()
        val now = SystemClock.elapsedRealtime()
        if (result == null) {
            if (now - seenAt > GONE_MS) sentKey = null
        } else {
            seenAt = now
            val key = result.employeeKey?.toString() ?: "u"
            if (key != sentKey) {
                sentKey = key
                if (!send(result, frame)) sentKey = null // 못 보냈으면 다음 장면에 다시
            }
        }
        main.postDelayed(tick, FRAME_MS)
    }

    private fun send(result: FaceResult, frame: Bitmap): Boolean {
        val body = JSONObject()
            .put("worker_key", result.employeeKey ?: nextTrack++)
            .put("is_worker", result.employeeKey != null)
            .put("appear_time", clock.format(Date()))
            .put("full_frame", jpegDataUrl(frame))
            .put("crop_frame", jpegDataUrl(crop(frame, result.box)))
        val r = api.send("POST", "/face/appear", body)
        Log.i(TAG, "appear ${result.employeeKey} score=%.2f -> ${r.code}".format(result.score))
        if (r.code == 409) { enabled = false; syncedAt = 0 } // 서버에서 AI 서버로 바뀜
        return r.ok
    }

    /** 얼굴 둘레를 조금 넉넉히 자른다 (관리자 웹 출입 기록의 얼굴 사진) */
    private fun crop(frame: Bitmap, box: RectF): Bitmap {
        val pad = box.height() * 0.25f
        val left = (box.left - pad).toInt().coerceIn(0, frame.width - 1)
        val top = (box.top - pad).toInt().coerceIn(0, frame.height - 1)
        val right = (box.right + pad).toInt().coerceIn(left + 1, frame.width)
        val bottom = (box.bottom + pad).toInt().coerceIn(top + 1, frame.height)
        return Bitmap.createBitmap(frame, left, top, right - left, bottom - top)
    }

    private fun sync() {
        val now = SystemClock.elapsedRealtime()
        if (syncedAt != 0L && now - syncedAt < SYNC_MS) return
        val r = api.send("GET", "/face/dataset")
        if (!r.ok) return // 서버에 닿지 않으면 지금 상태로 두고 다음에 다시
        syncedAt = now
        val json = r.json()
        enabled = json.optBoolean("enabled")
        if (!enabled) {
            // 꺼지면 모델과 등록 얼굴을 내려 메모리를 돌려준다
            recognizer?.close()
            recognizer = null
            galleryPaths = null
            return
        }
        val faces = json.getJSONArray("faces")
        val paths = mutableMapOf<Int, List<String>>()
        for (i in 0 until faces.length()) {
            val f = faces.getJSONObject(i)
            val list = f.getJSONArray("image_path")
            paths[f.getInt("worker_key")] = (0 until list.length()).map { list.getString(it) }
        }
        val all = paths.values.flatten()
        val r0 = recognizer ?: ScrfdLvFaceRecognizer.fromAssets(context).also { recognizer = it }
        if (all == galleryPaths) return
        val gallery = mutableMapOf<Int, List<Bitmap>>()
        for ((key, list) in paths) {
            gallery[key] = list.map { path ->
                val bytes = api.bytes(path) ?: return // 다 받지 못하면 다음에 다시 (지난 등록 얼굴 그대로)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
            }
        }
        r0.setGallery(gallery)
        gallery.values.flatten().forEach { it.recycle() }
        galleryPaths = all
        Log.i(TAG, "gallery ${gallery.size} people, ${all.size} photos")
    }

    companion object {
        private const val TAG = "FaceGate"
        private const val FRAME_MS = 500L
        private const val IDLE_MS = 5_000L
        private const val SYNC_MS = 60_000L
        /** 이만큼 얼굴이 안 보이면 다음 사람으로 본다 */
        private const val GONE_MS = 2_000L
    }
}
