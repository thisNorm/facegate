package com.example.facegate

import android.app.ActivityOptions
import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.util.Log
import kotlin.system.exitProcess

// shortcut: 크래시 재실행만 함. 부팅 자동 실행·키오스크(FR-T-06)는 1차 개발에서 Device Owner로 처리
class FaceGateApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Thread.setDefaultUncaughtExceptionHandler { _, error ->
            Log.e("FaceGate", "crash, restarting", error)
            val intent = Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            // Android 14+는 백그라운드 액티비티 시작을 막음. SYSTEM_ALERT_WINDOW(appops, README) + 생성자 권한 위임으로 허용
            @Suppress("DEPRECATION") // ALLOW_ALWAYS는 API 36부터라 14(WA8059T)에서는 ALLOWED를 씀
            val options = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ActivityOptions.makeBasic()
                    .setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                    .toBundle()
            } else {
                null
            }
            val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE, options)
            getSystemService(AlarmManager::class.java)
                .set(AlarmManager.RTC, System.currentTimeMillis() + 3000, pending)
            exitProcess(2)
        }
    }
}
