package com.example.facegate

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings

/** 기기 소유자 등록용. adb shell dpm set-device-owner com.example.facegate/.KioskAdmin (README) */
class KioskAdmin : DeviceAdminReceiver()

/**
 * 키오스크 (FR-T-06). 이 앱이 기기 소유자일 때만 켠다. 아니면 아무것도 하지 않아 개발 단말은 평소처럼 쓴다.
 * 홈 앱으로 고정해 부팅하면 바로 뜨고, 화면 고정(lock task)으로 홈, 최근 앱, 알림 막대를 막는다.
 */
object Kiosk {
    private fun dpm(context: Context) = context.getSystemService(DevicePolicyManager::class.java)
    private fun admin(context: Context) = ComponentName(context, KioskAdmin::class.java)

    fun isOn(context: Context) = dpm(context).isDeviceOwnerApp(context.packageName)

    /** 화면에 나올 때마다 부른다. 점검하러 설정에 다녀오면 여기서 다시 잠근다 */
    fun lock(activity: Activity) {
        if (!isOn(activity)) return
        val dpm = dpm(activity)
        val admin = admin(activity)
        dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
        val home = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        dpm.addPersistentPreferredActivity(admin, home, ComponentName(activity, MainActivity::class.java))
        dpm.setKeyguardDisabled(admin, true)
        dpm.setStatusBarDisabled(admin, true)
        // 충전기에 꽂혀 있는 동안 화면이 꺼지지 않게 (AC, USB, 무선)
        dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7")
        dpm.setPermissionGrantState(
            admin, activity.packageName, Manifest.permission.CAMERA,
            DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
        )
        val state = activity.getSystemService(ActivityManager::class.java).lockTaskModeState
        if (state == ActivityManager.LOCK_TASK_MODE_NONE) activity.startLockTask()
    }

    /** 점검: 화면 고정을 풀고 안드로이드 설정을 연다. 홈 버튼을 누르면 이 앱으로 돌아와 다시 잠긴다 */
    fun openSystemSettings(activity: Activity) {
        activity.stopLockTask()
        activity.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** 개발용 빌드에서만 부른다. 키오스크를 모두 풀고 기기 소유자에서 빠진다 (앱을 지울 수 있게) */
    fun release(activity: Activity) {
        if (!isOn(activity)) return
        val dpm = dpm(activity)
        val admin = admin(activity)
        activity.stopLockTask()
        dpm.clearPackagePersistentPreferredActivities(admin, activity.packageName)
        dpm.setKeyguardDisabled(admin, false)
        dpm.setStatusBarDisabled(admin, false)
        dpm.setLockTaskPackages(admin, emptyArray())
        dpm.clearDeviceOwnerApp(activity.packageName)
    }
}
