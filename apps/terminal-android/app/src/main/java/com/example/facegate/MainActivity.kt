package com.example.facegate

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.graphics.Bitmap
import android.view.MotionEvent
import android.view.SurfaceHolder
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.example.facegate.streaming.StreamController
import com.example.facegate.streaming.StreamCredentials
import com.example.facegate.streaming.StreamStatus
import com.pedro.library.view.OpenGlView
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var settings: TerminalSettings
    private lateinit var stream: StreamController
    private lateinit var statusView: TextView
    private lateinit var socket: TerminalSocket
    private lateinit var result: ResultScreen
    private lateinit var unpaired: UnpairedScreen
    private lateinit var scanner: QrScanner
    private lateinit var api: TerminalApi
    private lateinit var home: View
    private lateinit var homeButtons: View
    private lateinit var notice: TextView
    private lateinit var visitorCall: Button
    private lateinit var admin: AdminPanel
    private lateinit var phonePass: PhonePass
    private lateinit var faceGate: FaceGate
    private val pairing = PairingClient()
    private var pins = PinBox()
    private var pinServer: PinServer? = null
    private val hideResult = Runnable {
        result.hide()
        GateLight.idle()
    }
    private val hideNotice = Runnable { notice.visibility = View.GONE }
    private val callAgain = Runnable { visitorCall.isEnabled = true }
    private var serverConnected = false
    private var lastStream = StreamStatus(false, 0)
    private var surfaceReady = false
    private val appVersion by lazy { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }
    private val refreshAddress = object : Runnable {
        override fun run() {
            unpaired.addresses(localIpv4s())
            statusView.postDelayed(this, 5_000)
        }
    }
    private val rotatePin = object : Runnable {
        override fun run() {
            pins.rotate()
            unpaired.pin(pins.pin)
            statusView.postDelayed(this, PIN_ROTATE_MS)
        }
    }
    private val watchdog = object : Runnable {
        override fun run() {
            if (surfaceReady && settings.isPaired && !stream.isStreaming()) {
                android.util.Log.w("FaceGate", "stream stopped, restarting")
                stream.stop()
                startStream()
            }
            statusView.postDelayed(this, 10_000)
        }
    }

    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        setContentView(R.layout.activity_main)
        GateLight.idle()
        GateSound.init(this)
        settings = TerminalSettings(this)
        statusView = findViewById(R.id.status)
        result = ResultScreen(findViewById(R.id.result))
        unpaired = UnpairedScreen(findViewById(R.id.unpaired))
        api = TerminalApi(settings)
        home = findViewById(R.id.home)
        homeButtons = findViewById(R.id.home_buttons)
        notice = findViewById(R.id.home_notice)
        visitorCall = findViewById(R.id.visitor_call)
        socket = TerminalSocket(
            settings,
            ::showDecision,
            { m -> if (m.optString("type") == "voice") GateSound.applyVoice(m) else GateLight.apply(m) },
            { connected ->
                serverConnected = connected
                renderStatus()
                if (connected) loadSettings()
            },
            { settings.clear(); enterUnpaired() },
        )
        val preview = findViewById<OpenGlView>(R.id.preview)
        stream = StreamController(preview, { StreamCredentials(settings.rtspUser, settings.rtspPassword) }) { s ->
            runOnUiThread { lastStream = s; renderStatus() }
        }
        scanner = QrScanner(stream, ::onQr)
        faceGate = FaceGate(this, stream, api)
        preview.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surfaceReady = true
                startIfReady()
            }

            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

            override fun surfaceDestroyed(holder: SurfaceHolder) {
                surfaceReady = false
                scanner.stop()
                stream.stop()
            }
        })
        admin = AdminPanel(this, findViewById(R.id.admin), findViewById<LinearLayout>(R.id.admin_body), api, ::capture, ::showConnectionInfo, { Kiosk.openSystemSettings(this) }.takeIf { Kiosk.isOn(this) }) { reason ->
            homeButtons.visibility = View.VISIBLE
            faceGate.start()
            reason?.let { notice(it, 5_000) }
        }
        findViewById<View>(R.id.settings).setOnClickListener {
            homeButtons.visibility = View.GONE
            faceGate.stop() // 관리 중에는 출입 판정을 하지 않는다
            admin.enter()
        }
        visitorCall.setOnClickListener { callVisitor() }
        phonePass = PhonePass(this, api, findViewById(R.id.phone_qr))
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
        }
        if (!settings.isPaired) enterUnpaired() else showHome()
        statusView.postDelayed(watchdog, 10_000)
    }

    override fun onResume() {
        super.onResume()
        Kiosk.lock(this)
    }

    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        // 서피스 전이면 surfaceCreated의 startIfReady()가 처리한다
        if (surfaceReady) startIfReady()
    }

    private val cameraAllowed get() =
        checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun startIfReady() {
        if (!settings.isPaired) {
            // 미연결: 송출 없이 미리보기만 켜고 QR을 찾는다
            if (surfaceReady && cameraAllowed) {
                stream.startPreviewOnly()
                scanner.start()
            }
            return
        }
        startStream()
        socket.close()
        socket.connect()
    }

    private fun startStream() {
        if (cameraAllowed) stream.start()
    }

    /** 미연결 화면으로. 번호 창구를 열고, 번호는 10분마다 바꾼다 (D-57) */
    private fun enterUnpaired() {
        if (admin.isOpen) admin.close()
        home.visibility = View.GONE
        phonePass.stop()
        faceGate.stop()
        socket.close()
        stream.stop()
        pins = PinBox()
        pinServer?.stop()
        pinServer = PinServer(PIN_PORT, pins, { deviceJson(appVersion) }) { info ->
            runOnUiThread { onPaired(info, null) }
        }.also { server -> runCatching { server.start() }.onFailure { android.util.Log.w("FaceGate", "pin server", it) } }
        unpaired.show(localIpv4s(), pins.pin, appVersion)
        statusView.removeCallbacks(rotatePin)
        statusView.postDelayed(rotatePin, PIN_ROTATE_MS)
        statusView.removeCallbacks(refreshAddress)
        statusView.postDelayed(refreshAddress, 5_000)
        statusView.text = ""
        startIfReady()
    }

    private fun onQr(text: String) {
        val qr = parseQr(text) ?: return scanner.start() // 다른 QR이면 계속 찾는다
        unpaired.status("연결 중", UnpairedScreen.Kind.WORKING)
        thread {
            val url = pickServer(qr.serverUrls, pairing::hello)
            val result = url?.let { pairing.pair(it, qr.code, deviceJson(appVersion)) }
            runOnUiThread {
                when {
                    url == null -> retry("서버에 연결할 수 없습니다. 단말과 서버가 같은 망인지 확인하세요.")
                    result is PairResult.Ok -> onPaired(result.info, url)
                    result is PairResult.Refused -> retry(
                        when (result.error) {
                            "EXPIRED" -> "코드가 만료되었습니다. 관리자 웹에서 다시 발급하세요."
                            "USED" -> "이미 사용한 코드입니다."
                            "LOCKED" -> "잠시 뒤 다시 시도하세요."
                            else -> "코드가 맞지 않습니다."
                        },
                    )
                    else -> retry("서버에 연결할 수 없습니다. 단말과 서버가 같은 망인지 확인하세요.")
                }
            }
        }
    }

    private fun retry(message: String) {
        unpaired.status(message, UnpairedScreen.Kind.FAILED)
        statusView.postDelayed({
            if (!settings.isPaired && unpaired.isShown) {
                unpaired.status("QR을 찾는 중", UnpairedScreen.Kind.SEARCHING)
                scanner.start()
            }
        }, 3000)
    }

    /** 연결 정보를 받음. 번호 연결이면(url == null) 서버 주소를 직접 고른다 */
    private fun onPaired(info: PairingInfo, url: String?) {
        scanner.stop()
        unpaired.status("연결 중", UnpairedScreen.Kind.WORKING)
        thread {
            val server = url ?: pickServer(info.serverUrls, pairing::hello)
            runOnUiThread {
                if (server == null) {
                    // 저장하지 않는다. 웹에는 끊김으로 남으니 해제 후 다시 연결 (설계 7장)
                    retry("서버에 연결할 수 없습니다. 단말과 서버가 같은 망인지 확인하세요.")
                    return@runOnUiThread
                }
                settings.save(info, server)
                pinServer?.stop()
                pinServer = null
                statusView.removeCallbacks(rotatePin)
                statusView.removeCallbacks(refreshAddress)
                unpaired.status("${info.gateName}에 연결되었습니다\n단말 ${info.terminalKey}", UnpairedScreen.Kind.DONE)
                statusView.postDelayed({
                    unpaired.hide()
                    showHome()
                    stream.stop() // 미리보기만 켠 상태에서 인증 송출로 다시 시작
                    startIfReady()
                }, 2000)
            }
        }
    }

    private fun showConnectionInfo() {
        AlertDialog.Builder(this)
            .setTitle("연결 정보")
            .setMessage(
                "서버 ${settings.serverUrl} (${if (serverConnected) "연결" else "끊김"})\n게이트 ${settings.gateName}\n단말 ${settings.terminalKey}\n" +
                    "영상 송출 ${if (lastStream.streaming) "켜짐" else "꺼짐"}, 보는 곳 ${lastStream.clients}",
            )
            .setNegativeButton("닫기", null)
            .setPositiveButton("다시 연결") { _, _ ->
                AlertDialog.Builder(this)
                    .setMessage("연결 정보를 지우고 처음부터 다시 연결할까요? 관리자 웹에서도 이 단말을 연결 해제해 주세요.")
                    .setNegativeButton("취소", null)
                    .setPositiveButton("다시 연결") { _, _ ->
                        settings.clear()
                        enterUnpaired()
                    }
                    .show()
            }
            .show()
    }

    /** 관리 중이면 패널에서 나가지 않은 시간을 다시 센다 */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.action == MotionEvent.ACTION_DOWN) admin.touch()
        return super.dispatchTouchEvent(ev)
    }

    /** 미리보기 한 장 (화면과 좌우가 반대인 원래 영상). 송출 중일 때만 */
    private fun capture(done: (Bitmap?) -> Unit) {
        if (!stream.isStreaming()) return done(null)
        stream.snapshot { bitmap -> runOnUiThread { done(bitmap) } }
    }

    /** 방문객 호출 (D-58). 그 순간 사진을 붙여 관리자 웹에 알린다. 30초 동안 다시 누르지 못한다 */
    private fun callVisitor() {
        visitorCall.isEnabled = false
        notice("담당자를 부르는 중", CALL_COOLDOWN_MS)
        capture { bitmap ->
            thread {
                val body = org.json.JSONObject()
                bitmap?.let { body.put("photo", jpegDataUrl(it)) }
                val r = api.send("POST", "/visitor-calls", body)
                runOnUiThread {
                    if (r.ok) {
                        notice("담당자를 부르고 있습니다. 잠시 기다려 주세요.", CALL_COOLDOWN_MS)
                        visitorCall.postDelayed(callAgain, CALL_COOLDOWN_MS)
                    } else {
                        notice("호출하지 못했습니다. 잠시 뒤 다시 눌러 주세요.", 5_000)
                        visitorCall.isEnabled = true
                    }
                }
            }
        }
    }

    private fun notice(text: String, millis: Long) {
        notice.text = text
        notice.visibility = View.VISIBLE
        notice.removeCallbacks(hideNotice)
        notice.postDelayed(hideNotice, millis)
    }

    private fun showDecision(d: Decision) {
        phonePass.onDecision(d.result == "GRANTED") // 핸드폰이 값을 썼을 수 있어 새로 받는다
        if (admin.isOpen) return // 관리 중에는 통과 결과를 덮어 그리지 않는다
        val display = displayOf(d)
        if (d.result == "GRANTED") GateLight.granted() else GateLight.denied()
        GateSound.play(d.result)
        findViewById<FaceGuideView>(R.id.face_guide).flash(display.color, display.millis)
        result.show(display)
        statusView.removeCallbacks(hideResult)
        statusView.postDelayed(hideResult, display.millis) // 다음 결과가 오면 즉시 덮어씀
    }

    /** 붙을 때마다 서버의 불빛 색과 음성 안내 문구를 받는다. 떨어져 있던 사이 바뀐 것도 맞춘다 */
    private fun loadSettings() = thread {
        val light = api.send("GET", "/light")
        val voice = api.send("GET", "/voice")
        runOnUiThread {
            if (light.ok) GateLight.apply(light.json())
            if (voice.ok) GateSound.applyVoice(voice.json())
        }
    }

    private fun showHome() {
        findViewById<TextView>(R.id.home_gate).text = settings.gateName
        home.visibility = View.VISIBLE
        phonePass.start()
        faceGate.start()
        renderStatus()
    }

    /** 오른쪽 위 작은 상태. 자세한 값(접속 수 등)은 연결 정보에서 본다 */
    private fun renderStatus() {
        if (!settings.isPaired) return
        val problem = when {
            !serverConnected -> "서버 연결 끊김"
            !lastStream.streaming -> "영상 송출 꺼짐"
            else -> null
        }
        statusView.text = "●  ${problem ?: "정상 운영 중"}"
        statusView.setTextColor(if (problem == null) 0xFF9FE1CB.toInt() else 0xFFF7C1C1.toInt())
    }

    /**
     * 개발용 빌드에서만: 판정 화면, 불빛, 소리를 미리 본다. CONSENT는 생체정보 동의서 화면, KIOSK_OFF는 키오스크 풀기.
     * adb shell am start -n com.example.facegate/.MainActivity --es preview GRANTED
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val result = intent.getStringExtra("preview") ?: return
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
        when (result) {
            "CONSENT" -> admin.previewConsent()
            "KIOSK_OFF" -> Kiosk.release(this)
            else -> showDecision(Decision(result, "홍길동", "개발팀"))
        }
    }

    override fun onDestroy() {
        statusView.removeCallbacks(watchdog)
        statusView.removeCallbacks(rotatePin)
        statusView.removeCallbacks(refreshAddress)
        scanner.stop()
        phonePass.stop()
        faceGate.close()
        pinServer?.stop()
        socket.close()
        super.onDestroy()
    }

    companion object {
        private const val PIN_ROTATE_MS = 10 * 60_000L
        private const val CALL_COOLDOWN_MS = 30_000L
    }
}
