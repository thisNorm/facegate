package com.example.facegate.streaming

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.video.CameraCallbacks
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.library.view.OpenGlView
import com.pedro.rtspserver.RtspServerCamera2
import com.pedro.rtspserver.server.ClientListener
import com.pedro.rtspserver.server.ServerClient

data class StreamStatus(val streaming: Boolean, val clients: Int)
data class StreamCredentials(val user: String, val password: String)

// 1080p H.264 15fps 약 3.2Mbps (WA8059T 확인값, 04 문서 IF-6). 송출 모듈은 이 파일 하나로 분리 (FR-T-13).
class StreamController(
    private val view: OpenGlView,
    private val credentials: () -> StreamCredentials,
    private val onStatus: (StreamStatus) -> Unit,
) : ConnectChecker, ClientListener {
    private val camera = RtspServerCamera2(view, this, RTSP_PORT)
    private val clients = mutableSetOf<ServerClient>() // 라이브러리 콜백은 메인 스레드, 끊김 이벤트가 두 번 올 수 있어 Set으로 셈
    private val main = Handler(Looper.getMainLooper())

    init {
        // 카메라가 죽어도 isStreaming은 true로 남음. 멈춰 두면 MainActivity 감시가 다시 시작함. 콜백은 카메라 스레드라 메인으로 넘김
        camera.setCameraCallbacks(object : CameraCallbacks {
            override fun onCameraChanged(facing: CameraHelper.Facing) {}
            override fun onCameraOpened() {}
            override fun onCameraDisconnected() {
                main.post { stop() }
            }

            override fun onCameraError(error: String) {
                main.post { stop() }
            }
        })
    }

    fun start() {
        if (camera.isStreaming) return
        val auth = credentials()
        // 사용자나 비밀번호가 비면 라이브러리가 인증 없이 송출하므로 시작하지 않음
        if (auth.user.isBlank() || auth.password.isBlank()) {
            onStatus(StreamStatus(false, 0))
            return
        }
        camera.streamClient.setAuthorization(auth.user, auth.password)
        camera.streamClient.setClientListener(this)
        camera.streamClient.setOnlyVideo(true)
        // GOP 1초 (IF-6). 가로 설치(Q-35) 기준 회전 0, 단말에서 확인
        val prepared = camera.prepareVideo(1920, 1080, 15, 3_200_000, 1, 0)
        if (!prepared) {
            onStatus(StreamStatus(false, 0))
            return
        }
        // 회전을 직접 넘김. 생략하면 라이브러리가 "화면 회전 0 = 세로"로 가정해 90을 넣고, 가로가 기본인 이 단말에선 송출 영상만 세로로 잘림
        if (!camera.isOnPreview) camera.startPreview(CameraHelper.Facing.FRONT, 1920, 1080, 15, 0)
        camera.startStream()
        // 라이브러리는 폰처럼 센서가 270도라고 보고 카메라 영상을 돌림(startPreview·startStream 때마다 다시 설정).
        // 이 단말 전면 카메라는 센서 방향 0이라 영상이 옆으로 누움 → 송출 시작 뒤에 덮어씀
        view.setRotation(CAMERA_TEXTURE_ROTATION)
        onStatus(StreamStatus(true, clients.size))
    }

    /** 미연결 화면: 송출 없이 미리보기만 켜서 QR을 읽는다 */
    fun startPreviewOnly() {
        if (camera.isOnPreview) return
        camera.startPreview(CameraHelper.Facing.FRONT, 1920, 1080, 15, 0)
        view.setRotation(CAMERA_TEXTURE_ROTATION)
    }

    /** 미리보기 장면 한 장. 콜백은 GL 스레드에서 온다 */
    fun snapshot(onBitmap: (Bitmap) -> Unit) {
        if (camera.isOnPreview) view.takePhoto { bitmap -> onBitmap(bitmap) }
    }

    fun stop() {
        if (camera.isStreaming) camera.stopStream()
        if (camera.isOnPreview) camera.stopPreview()
        clients.clear()
        onStatus(StreamStatus(false, 0))
    }

    fun clientCount() = clients.size

    fun isStreaming() = camera.isStreaming

    override fun onClientConnected(client: ServerClient) {
        clients.add(client)
        onStatus(StreamStatus(camera.isStreaming, clients.size))
    }

    override fun onClientDisconnected(client: ServerClient) {
        clients.remove(client)
        onStatus(StreamStatus(camera.isStreaming, clients.size))
    }

    override fun onClientNewBitrate(bitrate: Long, client: ServerClient) {}

    override fun onConnectionStarted(url: String) {}

    override fun onConnectionSuccess() {}

    override fun onConnectionFailed(reason: String) {
        stop() // 서버 시작 실패 시 정리해야 다음 start()가 다시 시도함
    }

    override fun onNewBitrate(bitrate: Long) {}

    override fun onDisconnect() {}

    override fun onAuthError() {}

    override fun onAuthSuccess() {}

    companion object {
        const val CAMERA_TEXTURE_ROTATION = 0
        const val RTSP_PORT = 8555 // 8554는 단말 기본 앱(com.ipcam)이 사용 중
    }
}
