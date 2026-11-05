package com.example.facegate

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Log
import org.json.JSONObject
import java.util.Locale
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

/**
 * 판정 소리 (05 문서 T-02, T-03). 출입 단말들처럼 짧은 확인음 뒤에 한국어 음성 안내.
 * 이름은 뒷사람에게 들리므로 말하지 않는다. 미등록은 지나가는 사람에게도 울리므로 작은 삐만.
 */
object GateSound {
    private const val RATE = 22_050
    private val ATTRIBUTES = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private class Cue(val pcm: ShortArray, var speech: String?) {
        val track: AudioTrack by lazy { track(pcm) }
        val millis = pcm.size * 1000L / RATE
    }

    private val granted = Cue(bell(1319.0, 320), "인증되었습니다")
    private val denied = Cue(tone(392.0, 220), "출입 권한이 없습니다")
    private val unregistered = Cue(tone(392.0, 120, volume = 0.35), null)

    private val handler = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    /** 앱 시작 때 한 번. 한국어 음성이 없으면 확인음만 낸다 */
    fun init(context: Context) {
        tts = TextToSpeech(context.applicationContext) { status ->
            val t = tts ?: return@TextToSpeech
            val lang = if (status == TextToSpeech.SUCCESS) t.setLanguage(Locale.KOREAN) else TextToSpeech.ERROR
            ttsReady = lang >= TextToSpeech.LANG_AVAILABLE
            if (ttsReady) {
                t.setAudioAttributes(ATTRIBUTES)
                t.setSpeechRate(1.1f)
            } else Log.w("FaceGate", "Korean TTS unavailable ($status, $lang)")
        }
    }

    /** 관리자 웹에서 정한 문구 (GET /voice 응답 또는 voice 메시지). 빈 글자면 확인음만 */
    fun applyVoice(json: JSONObject) {
        fun line(key: String) = json.optString(key).trim().ifEmpty { null }
        if (json.has("granted")) granted.speech = line("granted")
        if (json.has("denied")) denied.speech = line("denied")
        if (json.has("unregistered")) unregistered.speech = line("unregistered")
    }

    fun play(result: String) {
        val cue = when (result) {
            "GRANTED" -> granted
            "UNREGISTERED" -> unregistered
            else -> denied
        }
        handler.removeCallbacksAndMessages(null)
        tts?.stop()
        try {
            cue.track.stop()
            cue.track.reloadStaticData()
            cue.track.play()
        } catch (e: Exception) {
            Log.w("FaceGate", "result sound failed", e)
        }
        val speech = cue.speech ?: return
        // 다음 사람 결과가 오면 위에서 멈추고 새로 시작한다
        handler.postDelayed({
            if (ttsReady) tts?.speak(speech, TextToSpeech.QUEUE_FLUSH, null, "result")
        }, cue.millis)
    }

    /** 앞뒤 10ms를 부드럽게 줄여 딱 소리를 없앤 사인파 */
    private fun tone(hz: Double, ms: Int, volume: Double = 0.8): ShortArray {
        val n = RATE * ms / 1000
        val fade = RATE / 100
        return ShortArray(n) { i ->
            val edge = min(1.0, min(i, n - 1 - i).toDouble() / fade)
            (sin(2 * PI * hz * i / RATE) * edge * volume * Short.MAX_VALUE).toInt().toShort()
        }
    }

    /** 배음을 섞고 빨리 잦아드는 종소리 '띵' */
    private fun bell(hz: Double, ms: Int): ShortArray {
        val n = RATE * ms / 1000
        return ShortArray(n) { i ->
            val t = i.toDouble() / RATE
            val attack = min(1.0, i / (RATE / 200.0))
            val wave = sin(2 * PI * hz * t) + 0.4 * sin(4 * PI * hz * t) + 0.15 * sin(6 * PI * hz * t)
            (wave / 1.55 * attack * exp(-t / 0.12) * 0.9 * Short.MAX_VALUE).toInt().toShort()
        }
    }

    private fun track(pcm: ShortArray): AudioTrack =
        AudioTrack.Builder()
            .setAudioAttributes(ATTRIBUTES)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
            .apply { write(pcm, 0, pcm.size) }
}
