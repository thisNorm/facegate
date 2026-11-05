package com.example.facegate

import android.os.Build
import android.view.View
import android.widget.TextView
import java.net.Inet4Address
import java.net.NetworkInterface

/** 단말의 IPv4 주소들 (루프백 제외). 관리자가 번호 연결에 쓴다 */
fun localIpv4s(): List<String> = runCatching {
    NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .map { it.hostAddress.orEmpty() }
}.getOrDefault(emptyList())

/** 482913 → "482 913" */
fun spacedPin(pin: String) = if (pin.length == 6) "${pin.take(3)} ${pin.drop(3)}" else pin

/** 미연결 화면 (view_unpaired.xml). 상태 글자만 바뀌고 누르는 것은 없다 */
class UnpairedScreen(private val root: View) {
    enum class Kind(val color: Int) {
        SEARCHING(0xFFECECEA.toInt()),
        WORKING(0xFFECECEA.toInt()),
        FAILED(0xFFF7C1C1.toInt()),
        DONE(0xFF9FE1CB.toInt()),
    }

    private val address = root.findViewById<TextView>(R.id.unpaired_address)
    private val pin = root.findViewById<TextView>(R.id.unpaired_pin)
    private val status = root.findViewById<TextView>(R.id.unpaired_status)
    private val footer = root.findViewById<TextView>(R.id.unpaired_footer)

    fun show(addresses: List<String>, currentPin: String, appVersion: String) {
        addresses(addresses)
        pin.text = spacedPin(currentPin)
        footer.text = "기기 ${Build.MODEL}      앱 $appVersion      번호는 10분마다 바뀝니다"
        status("QR을 찾는 중", Kind.SEARCHING)
        root.visibility = View.VISIBLE
    }

    /** 선을 꽂거나 Wi-Fi를 바꾸면 주소가 바뀌어서 주기적으로 다시 넣는다 */
    fun addresses(list: List<String>) {
        address.text = list.ifEmpty { listOf("네트워크 없음") }.joinToString("   ")
    }

    fun pin(currentPin: String) {
        pin.text = spacedPin(currentPin)
    }

    fun status(text: String, kind: Kind) {
        status.text = text
        status.setTextColor(kind.color)
    }

    fun hide() {
        root.visibility = View.GONE
    }

    val isShown get() = root.visibility == View.VISIBLE
}
