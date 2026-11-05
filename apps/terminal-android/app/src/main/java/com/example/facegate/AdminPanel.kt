package com.example.facegate

import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import kotlin.concurrent.thread

/**
 * 단말 관리자 모드 (D-58). 오른쪽 패널 안에서 화면을 바꿔 그린다.
 * 뒤의 미리보기와 얼굴 틀은 그대로 보여서 등록 사진을 그 자리에서 찍는다.
 */
class AdminPanel(
    private val activity: Activity,
    private val root: View,
    private val body: LinearLayout,
    private val api: TerminalApi,
    /** 미리보기 한 장. 못 찍으면 null. UI 스레드로 돌려준다 */
    private val capture: ((Bitmap?) -> Unit) -> Unit,
    private val connectionInfo: () -> Unit,
    /** 키오스크일 때만: 화면 고정을 풀고 안드로이드 설정을 연다 (점검용) */
    private val systemSettings: (() -> Unit)?,
    /** 나감. 이유가 있으면 평소 화면에 잠깐 띄운다 */
    private val onClose: (String?) -> Unit,
) {
    private val dp = activity.resources.displayMetrics.density
    private val idle = Runnable { close("관리 화면을 닫았습니다") }
    private var adminName = ""
    private var lastQuery = ""
    /** 화면을 바꾸면 늘어난다. 늦게 온 응답이 다른 화면에 그려지지 않게 */
    private var page = 0
    /** 떠 있는 동의서. 관리 화면이 닫히면 같이 닫는다 (관리자 확인이 끝난 뒤 동의를 눌러도 등록되지 않으므로) */
    private var consentDialog: Dialog? = null

    val isOpen get() = root.visibility == View.VISIBLE

    /** 설정 버튼. 서버가 정한 방식(계정 또는 관리자 번호)으로 확인한다. 서버에 닿지 않으면 연결 정보만 */
    fun enter() {
        work({ api.send("GET", "/admin/mode") }) { r ->
            when {
                r.code == 0 -> {
                    onClose("서버에 연결할 수 없어 연결 정보만 볼 수 있습니다")
                    connectionInfo()
                }
                !r.ok -> onClose(failText(r))
                r.json().optString("mode") == "PIN" -> askPin(null)
                else -> askAccount(null)
            }
        }
    }

    /** 패널 밖(평소 화면)에서 호출하므로 page 검사 없이 돌린다 */
    private fun <T> work(job: () -> T, done: (T) -> Unit) {
        thread { val result = job(); activity.runOnUiThread { done(result) } }
    }

    private fun askAccount(error: String?) {
        val box = dialogBox(error)
        val id = dialogField(box, "아이디", InputType.TYPE_CLASS_TEXT)
        val pw = dialogField(box, "비밀번호", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        AlertDialog.Builder(activity).setTitle("관리자 확인").setView(box)
            .setNegativeButton("취소") { _, _ -> onClose(null) }
            .setOnCancelListener { onClose(null) }
            .setPositiveButton("확인") { _, _ ->
                val json = JSONObject().put("loginId", id.text.toString().trim()).put("password", pw.text.toString())
                work({ api.send("POST", "/admin/login", json) }) { r -> loggedIn(r) ?: askAccount(loginError(r)) }
            }
            .show()
    }

    private fun askPin(error: String?) {
        val box = dialogBox(error)
        val pin = dialogField(box, "관리자 번호", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD)
        pin.filters = arrayOf(InputFilter.LengthFilter(8))
        AlertDialog.Builder(activity).setTitle("관리자 번호").setView(box)
            .setNegativeButton("취소") { _, _ -> onClose(null) }
            .setOnCancelListener { onClose(null) }
            .setPositiveButton("확인") { _, _ ->
                val json = JSONObject().put("pin", pin.text.toString())
                work({ api.send("POST", "/admin/pin-login", json) }) { r -> loggedIn(r) ?: askPin(loginError(r)) }
            }
            .show()
    }

    /** 성공이면 패널을 열고 Unit, 실패면 null */
    private fun loggedIn(r: TerminalApi.Reply): Unit? {
        if (!r.ok) return null
        val json = r.json()
        api.adminToken = json.getString("token")
        adminName = json.getJSONObject("admin").optString("name")
        root.visibility = View.VISIBLE
        menu()
        touch()
        return Unit
    }

    private fun loginError(r: TerminalApi.Reply) = when (r.code) {
        0 -> "서버에 연결할 수 없습니다"
        401 -> "맞지 않습니다. 다시 입력하세요."
        423 -> "여러 번 틀려 잠겼습니다. 10분 뒤 다시 하세요."
        else -> failText(r)
    }

    /** 누를 때마다 다시 센다. 3분 동안 누르지 않으면 나간다 */
    fun touch() {
        if (!isOpen) return
        root.removeCallbacks(idle)
        root.postDelayed(idle, IDLE_MS)
    }

    fun close(reason: String? = null) {
        root.removeCallbacks(idle)
        consentDialog?.dismiss()
        consentDialog = null
        api.adminToken = null // shortcut: 서버 세션은 만료(10분)까지 남는다. 단말 로그아웃 API가 생기면 호출
        page++
        hideKeyboard()
        body.removeAllViews()
        root.visibility = View.GONE
        onClose(reason)
    }

    // ---- 화면들 ----

    private fun menu() {
        screen("관리 중", back = null)
        note(adminName)
        button("문 열기", primary = true) { openGate() }
        button("직원 등록") { register() }
        button("직원 찾기") { search(lastQuery) }
        button("불빛 색") { lightColors() }
        button("연결 정보") { connectionInfo() }
        systemSettings?.let { open -> button("단말 설정 열기") { confirm("화면 고정을 풀고 안드로이드 설정을 엽니다. 점검이 끝나면 홈 버튼을 누르세요.") { close(); open() } } }
        button("나가기") { close() }
        note("3분 동안 누르지 않으면 자동으로 나갑니다")
    }

    private fun openGate() {
        screen("문 열기")
        val reasons = listOf("VISITOR" to "방문객", "RECOGNITION_FAILED" to "직원 인증 불가", "OTHER" to "기타")
        val group = RadioGroup(activity)
        reasons.forEachIndexed { i, (_, label) ->
            group.addView(RadioButton(activity).apply {
                id = i + 1
                text = label
                textSize = 16f
                setTextColor(TEXT)
                buttonTintList = ColorStateList.valueOf(TEXT)
            })
        }
        body.addView(group)
        val input = field("방문객 이름")
        group.setOnCheckedChangeListener { _, checked ->
            input.hint = when (checked) { 1 -> "방문객 이름"; 3 -> "사유"; else -> "메모 (선택)" }
        }
        group.check(1)
        val result = note("")
        button("열기", primary = true) {
            val reason = reasons[group.checkedRadioButtonId - 1].first
            val value = input.text.toString().trim()
            if (reason != "RECOGNITION_FAILED" && value.isEmpty()) {
                result.text = if (reason == "VISITOR") "방문객 이름을 입력하세요" else "사유를 입력하세요"
                return@button
            }
            val json = JSONObject().put("reason", reason)
            if (reason == "VISITOR") json.put("visitor", JSONObject().put("name", value))
            else if (value.isNotEmpty()) json.put("note", value)
            result.text = "여는 중"
            call({ api.send("POST", "/open", json) }) { r ->
                result.text = when {
                    r.ok -> "문을 열었습니다"
                    r.code == 502 -> "게이트 장치가 응답하지 않습니다"
                    else -> failText(r)
                }
            }
        }
    }

    /** 대기, 통과, 불통마다 정해 둔 색 중 하나를 고른다. 저장하면 같은 서버의 모든 단말에 적용 */
    private fun lightColors() {
        screen("불빛 색")
        val picked = GateLight.chosen.toMutableMap()
        val redraws = mutableListOf<() -> Unit>()
        for ((state, label) in GateLight.STATES) {
            val title = text("", 16f)
            val chips = row()
            val redraw = {
                title.text = "$label: ${GateLight.COLORS.getValue(picked.getValue(state)).label}"
                for (i in 0 until chips.childCount) {
                    val name = chips.getChildAt(i).tag as String
                    chips.getChildAt(i).background = chip(GateLight.COLORS.getValue(name).swatch, name == picked[state])
                }
            }
            for ((name, color) in GateLight.COLORS) {
                chips.addView(View(activity).apply {
                    tag = name
                    contentDescription = "$label ${color.label}"
                    setOnClickListener { picked[state] = name; redraws.forEach { it() } }
                }, LinearLayout.LayoutParams(px(38), px(38)).apply { marginEnd = px(9) })
            }
            redraws += redraw
            redraw()
        }
        val result = note("")
        button("저장", primary = true) {
            result.text = "저장하는 중"
            val json = JSONObject(picked as Map<*, *>)
            call({ api.send("PUT", "/light", json) }) { r ->
                if (r.ok) GateLight.apply(r.json())
                result.text = if (r.ok) "저장했습니다" else failText(r)
            }
        }
    }

    private fun chip(color: Int, selected: Boolean) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
        setStroke(px(if (selected) 4 else 1), if (selected) 0xFF5DCAA5.toInt() else MUTED)
    }

    /**
     * 소속 고르기 (D-59). 서버 소속 목록을 가로로 늘어놓은 버튼 중 하나, 없음 가능.
     * 고른 소속 이름(직원의 department 글자)을 돌려주는 함수를 준다
     */
    private fun orgPicker(current: String): () -> String {
        var chosen = current
        val label = text("소속: ${current.ifEmpty { "없음" }}", 16f)
        val chips = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        body.addView(HorizontalScrollView(activity).apply { addView(chips) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                .apply { bottomMargin = px(10) })
        call({ api.send("GET", "/orgs") }) { r ->
            if (!r.ok) { label.text = "소속 목록을 불러오지 못했습니다"; return@call }
            val orgs = JSONArray(r.text)
            val names = listOf("") + (0 until orgs.length()).map { orgs.getJSONObject(it).getString("name") }
            fun draw() {
                chips.removeAllViews()
                for (name in names) {
                    chips.addView(buttonView(name.ifEmpty { "없음" }, name == chosen) {
                        chosen = name
                        label.text = "소속: ${name.ifEmpty { "없음" }}"
                        draw()
                    }.apply { gravity = Gravity.CENTER },
                        LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(44)).apply { marginEnd = px(6) })
                }
            }
            draw()
        }
        return { chosen }
    }

    private fun register() {
        screen("직원 등록")
        val no = field("사번")
        val name = field("이름")
        val dept = orgPicker("")
        val shots = mutableListOf<Bitmap>()
        val pose = text("", 16f)
        val thumbs = row()
        val result = note("")
        fun refresh() {
            pose.text = if (shots.size < POSES.size) "사진 ${shots.size + 1}/${POSES.size}   ${POSES[shots.size]}"
            else "사진 ${POSES.size}장을 모두 찍었습니다"
        }
        refresh()
        button("찍기") {
            if (shots.size >= POSES.size) return@button
            capture { bitmap ->
                if (bitmap == null) { result.text = "사진을 찍지 못했습니다"; return@capture }
                shots += bitmap
                thumbs.addView(thumb(bitmap))
                refresh()
            }
        }
        button("마지막 사진 지우기") {
            if (shots.isEmpty()) return@button
            shots.removeAt(shots.lastIndex)
            thumbs.removeViewAt(thumbs.childCount - 1)
            refresh()
        }
        button("등록", primary = true) {
            result.text = when {
                no.value.isEmpty() || name.value.isEmpty() -> "사번과 이름을 입력하세요"
                shots.isEmpty() -> "사진을 1장 이상 찍으세요"
                else -> ""
            }
            if (result.text.isNotEmpty()) return@button
            // 찍은 사진은 본인이 동의해야 서버로 보낸다. 동의서에는 입력한 사번, 이름, 소속이 채워진다
            askConsent(name.value, dept(), no.value, onDecline = { result.text = it ?: DECLINED }) {
            result.text = "등록 중"
            val photos = shots.toList()
            call({
                val json = JSONObject().put("employeeNo", no.value).put("name", name.value)
                    .put("department", dept()).put("consent", true)
                    .put("photos", JSONArray(photos.map(::jpegDataUrl)))
                api.send("POST", "/employees", json)
            }) { r ->
                if (r.ok) detail(r.json().getInt("employeeKey"), "등록했습니다") else result.text = failText(r)
            }
            }
        }
        note("등록을 누르면 직원 본인이 동의서를 확인하고 동의합니다")
    }

    private fun search(query: String) {
        screen("직원 찾기")
        val q = field("이름 또는 사번", query)
        val list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        fun load() {
            lastQuery = q.value
            call({ api.send("GET", "/employees?q=" + URLEncoder.encode(lastQuery, "UTF-8")) }) { r ->
                list.removeAllViews()
                if (!r.ok) { list.addView(noteView(failText(r))); return@call }
                val found = JSONArray(r.text)
                if (found.length() == 0) list.addView(noteView("찾은 직원이 없습니다"))
                for (i in 0 until minOf(found.length(), MAX_LIST)) {
                    val e = found.getJSONObject(i)
                    val retired = if (e.optString("status") == "RETIRED") "   퇴사" else ""
                    list.addView(buttonView("${e.getString("name")}   ${e.getString("employeeNo")}   ${e.optString("department")}$retired", false) {
                        detail(e.getInt("employeeKey"))
                    })
                }
                if (found.length() > MAX_LIST) list.addView(noteView("앞의 ${MAX_LIST}명만 보입니다. 더 좁혀 찾으세요."))
            }
        }
        button("찾기", primary = true) { load() }
        body.addView(list)
        load()
    }

    private fun detail(key: Int, message: String = "") {
        screen("직원 정보", back = { search(lastQuery) })
        val result = note(message)
        call({ api.send("GET", "/employees/$key") }) { r ->
            if (!r.ok) { result.text = failText(r); return@call }
            val e = r.json()
            val active = e.optString("status") == "ACTIVE"
            val no = field("사번", e.getString("employeeNo"))
            val name = field("이름", e.getString("name"))
            val dept = orgPicker(e.optString("department"))
            if (active) button("저장") {
                val json = JSONObject().put("employeeNo", no.value).put("name", name.value).put("department", dept())
                call({ api.send("PATCH", "/employees/$key", json) }) { u -> result.text = if (u.ok) "저장했습니다" else failText(u) }
            } else note("퇴사한 직원입니다")
            val faces = e.getJSONArray("faces")
            text("얼굴 사진 ${faces.length()}장", 16f)
            for (i in 0 until faces.length()) faceRow(key, faces.getJSONObject(i), active)
            if (!active) return@call
            // 동의 기록이 없으면 찍은 사진을 올리기 전에 본인 동의부터 (FR-A-03)
            var consent = !e.isNull("consentAt")
            button("사진 찍어 추가") {
                capture { bitmap ->
                    if (bitmap == null) { result.text = "사진을 찍지 못했습니다"; return@capture }
                    fun upload() {
                        result.text = "올리는 중"
                        call({
                            val json = JSONObject().put("photos", JSONArray(listOf(jpegDataUrl(bitmap))))
                                .put("consent", consent)
                            api.send("POST", "/employees/$key/photos", json)
                        }) { a -> if (a.ok) detail(key, "사진을 추가했습니다") else result.text = failText(a) }
                    }
                    if (consent) upload()
                    else askConsent(name.value, dept(), no.value, onDecline = { result.text = it ?: DECLINED }) {
                        consent = true
                        upload()
                    }
                }
            }
            button("퇴사 처리") {
                confirm("${e.getString("name")} 님을 퇴사 처리할까요? 얼굴 사진이 지워지고 게이트를 통과할 수 없습니다.") {
                    call({ api.send("POST", "/employees/$key/retire") }) { t ->
                        if (t.ok) detail(key, "퇴사 처리했습니다") else result.text = failText(t)
                    }
                }
            }
        }
    }

    private fun faceRow(key: Int, face: JSONObject, active: Boolean) {
        val faceKey = face.getInt("faceImageKey")
        val line = row()
        val image = ImageView(activity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setBackgroundColor(0xFF1E1F23.toInt()) }
        line.addView(image, LinearLayout.LayoutParams(px(72), px(72)))
        line.addView(noteView(face.optString("createdAt").take(16).replace('T', ' ')).apply { setPadding(px(12), 0, 0, 0) },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (active) line.addView(buttonView("삭제", false) {
            confirm("이 사진을 지울까요?") {
                call({ api.send("DELETE", "/employees/$key/photos/$faceKey") }) { d ->
                    if (d.ok) detail(key, "사진을 지웠습니다") else detail(key, failText(d))
                }
            }
        }, LinearLayout.LayoutParams(px(88), px(48)))
        call({ api.bytes("/employees/$key/photos/$faceKey")?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }) { bitmap ->
            image.setImageBitmap(bitmap)
        }
    }

    /**
     * 생체정보 동의서 (서버 GET /consent, 웹과 같은 문구). 등록할 직원 본인이 화면 전체로 읽고 직접 누른다.
     * 아래 고정 줄의 오른쪽 버튼은 끝까지 내려가기 전에는 "끝까지 보기"로 맨 아래까지 내리고, 그 뒤에 "동의합니다"가 된다
     */
    private fun askConsent(name: String, dept: String, no: String, onDecline: (String?) -> Unit, onAgree: () -> Unit) {
        call({ api.send("GET", "/consent") }) { r ->
            // 불러오지 못한 것은 거절과 구분해 알린다
            if (!r.ok) onDecline("동의서를 불러오지 못했습니다: ${failText(r)}")
            else showConsent(r.json(), name, dept, no, onDecline, onAgree)
        }
    }

    /** 개발용 빌드의 미리 보기 (MainActivity onNewIntent). 관리 화면 밖에서 띄운다 */
    fun previewConsent() {
        work({ api.send("GET", "/consent") }) { r ->
            if (r.ok) showConsent(r.json(), "홍길동", "개발팀", "E2026001", {}, {})
            else onClose("동의서를 불러오지 못했습니다 (${r.code})")
        }
    }

    private fun showConsent(doc: JSONObject, name: String, dept: String, no: String, onDecline: (String?) -> Unit, onAgree: () -> Unit) {
        run {
            val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            fun label(value: String, size: Float, color: Int = BODY, bold: Boolean = false) = TextView(activity).apply {
                text = value
                textSize = size
                setTextColor(color)
                setLineSpacing(0f, 1.45f)
                if (bold) typeface = Typeface.DEFAULT_BOLD
            }
            val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
            val fill = ViewGroup.LayoutParams.MATCH_PARENT
            fun spaced(top: Int) = LinearLayout.LayoutParams(fill, wrap).apply { topMargin = px(top) }

            // 머리: 누구의 동의인지
            val header = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(px(48), px(28), px(48), px(20))
                addView(label("생체정보 동의", 14f, ACCENT, bold = true))
                addView(label(doc.getString("title"), 24f, TEXT, bold = true), spaced(4))
                val who = listOfNotNull(no.ifEmpty { null }?.let { "사번 $it" }, dept.ifEmpty { null }).joinToString(", ")
                addView(label("${name.ifEmpty { "이름 미입력" }} 님" + if (who.isEmpty()) "" else " ($who)", 16f, MUTED), spaced(4))
            }

            // 본문: 가운데 종이 한 장
            val paper = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(px(40), px(36), px(40), px(36))
                background = GradientDrawable().apply { setColor(PAPER); cornerRadius = px(16).toFloat() }
            }
            val intro = doc.getJSONArray("intro")
            for (i in 0 until intro.length()) paper.addView(label(intro.getString(i), 16f), spaced(if (i == 0) 0 else 10))
            val sections = doc.getJSONArray("sections")
            for (i in 0 until sections.length()) {
                val section = sections.getJSONObject(i)
                paper.addView(label(section.getString("title"), 18f, TEXT, bold = true), spaced(28))
                val lines = section.getJSONArray("lines")
                for (k in 0 until lines.length()) {
                    val line = lines.getString(k)
                    if (!line.startsWith("- ")) { paper.addView(label(line, 16f), spaced(8)); continue }
                    // 글머리표는 둘째 줄부터 글자에 맞춰 들여 쓴다
                    paper.addView(LinearLayout(activity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        addView(label("•", 16f, ACCENT), LinearLayout.LayoutParams(px(22), wrap))
                        addView(label(line.removePrefix("- "), 16f), LinearLayout.LayoutParams(0, wrap, 1f))
                    }, spaced(8))
                }
            }
            paper.addView(label(doc.getString("agreement"), 17f, TEXT, bold = true).apply {
                setPadding(px(24), px(20), px(24), px(20))
                background = GradientDrawable().apply { setColor(HIGHLIGHT); cornerRadius = px(12).toFloat() }
            }, spaced(32))
            val facts = listOf(
                "성명" to name.ifEmpty { "-" },
                "소속" to dept.ifEmpty { "없음" },
                "사번" to no.ifEmpty { "-" },
                "동의일" to java.time.LocalDate.now().toString(),
            )
            for ((key, value) in facts) paper.addView(LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(label(key, 16f, MUTED), LinearLayout.LayoutParams(px(96), wrap))
                addView(label(value, 16f, TEXT), LinearLayout.LayoutParams(0, wrap, 1f))
            }, spaced(if (key == "성명") 24 else 6))
            paper.addView(label("동의서 ${doc.getString("version")}판", 13f, MUTED), spaced(24))

            val content = FrameLayout(activity).apply { setPadding(px(48), 0, px(48), px(32)) }
            content.addView(paper, FrameLayout.LayoutParams(fill, wrap))
            val scroll = ScrollView(activity).apply { addView(content); isVerticalScrollBarEnabled = true }

            // 아래 고정 줄
            var atEnd = false
            val decline = buttonView("동의하지 않음", false) { dialog.dismiss(); onDecline(null) }.apply { gravity = Gravity.CENTER }
            val agree = buttonView("끝까지 보기", true) {}.apply { gravity = Gravity.CENTER }
            fun reachedEnd() {
                if (atEnd) return
                atEnd = true
                agree.text = "동의합니다"
            }
            agree.setOnClickListener {
                touch()
                if (atEnd) { dialog.dismiss(); onAgree() }
                else { scroll.smoothScrollTo(0, content.height); reachedEnd() }
            }
            scroll.setOnScrollChangeListener { _, _, y, _, _ ->
                touch()
                if (y + scroll.height >= content.height - px(24)) reachedEnd()
            }
            // 화면에 다 들어가면 내릴 것이 없다
            scroll.post { if (content.height <= scroll.height) reachedEnd() }
            val bar = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(px(48), px(16), px(48), px(20))
                setBackgroundColor(BAR)
                addView(decline, LinearLayout.LayoutParams(0, px(60), 1f).apply { marginEnd = px(12) })
                addView(agree, LinearLayout.LayoutParams(0, px(60), 2f))
            }

            dialog.setContentView(LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(SHEET)
                addView(header, LinearLayout.LayoutParams(fill, wrap))
                addView(scroll, LinearLayout.LayoutParams(fill, 0, 1f))
                addView(bar, LinearLayout.LayoutParams(fill, wrap))
            })
            dialog.setOnCancelListener { onDecline(null) }
            dialog.setOnDismissListener { if (consentDialog === dialog) consentDialog = null }
            consentDialog = dialog
            dialog.show()
        }
    }

    // ---- 그리는 도구 ----

    private fun <T> call(job: () -> T, done: (T) -> Unit) {
        val at = page
        thread {
            val result = job()
            activity.runOnUiThread { if (isOpen && page == at) done(result) }
        }
    }

    private fun failText(r: TerminalApi.Reply): String = when {
        r.code == 0 -> "서버에 연결할 수 없습니다"
        r.code == 401 -> {
            root.post { close("관리자 확인 시간이 지났습니다. 다시 들어와 주세요.") }
            "관리자 확인 시간이 지났습니다"
        }
        r.code == 404 -> "찾을 수 없습니다"
        "already exists" in r.error -> "이미 있는 사번입니다"
        "at most" in r.error -> "사진은 한 사람에 10장까지입니다"
        "retired" in r.error -> "퇴사한 직원입니다"
        "consent" in r.error -> "본인 동의를 먼저 받으세요"
        "unknown department" in r.error -> "없는 소속입니다"
        r.code == 400 -> "입력한 내용을 확인하세요"
        else -> "처리하지 못했습니다 (${r.code})"
    }

    private fun screen(title: String, back: (() -> Unit)? = ::menu) {
        page++
        hideKeyboard()
        body.removeAllViews()
        root.scrollTo(0, 0)
        if (back != null) body.addView(buttonView("뒤로", false) { back() }.apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(px(96), px(44)).apply { bottomMargin = px(12) })
        text(title, 22f)
    }

    private fun text(value: String, size: Float): TextView = TextView(activity).apply {
        text = value
        textSize = size
        setTextColor(TEXT)
        setPadding(0, px(4), 0, px(8))
    }.also(body::addView)

    private fun noteView(value: String) = TextView(activity).apply {
        text = value
        textSize = 13f
        setTextColor(MUTED)
        setPadding(0, px(4), 0, px(8))
    }

    private fun note(value: String) = noteView(value).also(body::addView)

    private fun buttonView(label: String, primary: Boolean, onClick: () -> Unit) = Button(activity).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        stateListAnimator = null
        gravity = Gravity.CENTER_VERTICAL or Gravity.START
        setPadding(px(16), 0, px(16), 0)
        setBackgroundResource(if (primary) R.drawable.btn_primary else R.drawable.btn_plain)
        setTextColor(if (primary) 0xFF151619.toInt() else TEXT)
        setOnClickListener { onClick() }
    }

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) =
        body.addView(buttonView(label, primary, onClick),
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(52)).apply { bottomMargin = px(10) })

    private fun field(hint: String, value: String = ""): EditText = EditText(activity).apply {
        this.hint = hint
        setText(value)
        textSize = 16f
        isSingleLine = true
        setTextColor(TEXT)
        setHintTextColor(MUTED)
        setBackgroundResource(R.drawable.field)
        setPadding(px(14), 0, px(14), 0)
    }.also { body.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(52)).apply { bottomMargin = px(10) }) }

    private val EditText.value get() = text.toString().trim()


    private fun row() = LinearLayout(activity).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 0, 0, px(10))
    }.also(body::addView)

    private fun thumb(bitmap: Bitmap) = ImageView(activity).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        setImageBitmap(bitmap)
        layoutParams = LinearLayout.LayoutParams(px(56), px(56)).apply { marginEnd = px(6) }
    }

    private fun confirm(message: String, onYes: () -> Unit) {
        AlertDialog.Builder(activity).setMessage(message)
            .setNegativeButton("취소", null)
            .setPositiveButton("확인") { _, _ -> onYes() }
            .show()
    }

    private fun dialogBox(error: String?) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(px(24), px(8), px(24), 0)
        if (error != null) addView(TextView(activity).apply { text = error; setTextColor(0xFFF09595.toInt()) })
    }

    private fun dialogField(box: LinearLayout, hint: String, type: Int) = EditText(activity).apply {
        this.hint = hint
        inputType = type
        isSingleLine = true
    }.also(box::addView)

    private fun hideKeyboard() {
        val imm = activity.getSystemService(InputMethodManager::class.java)
        imm.hideSoftInputFromWindow(root.windowToken, 0)
    }

    private fun px(value: Int) = (value * dp).toInt()

    companion object {
        private const val IDLE_MS = 3 * 60_000L
        private const val MAX_LIST = 30
        private const val TEXT = 0xFFECECEA.toInt()
        private const val MUTED = 0xFF9A9994.toInt()
        // 동의서 화면 색 (평소 화면과 같은 어두운 바탕)
        private const val SHEET = 0xFF101114.toInt()
        private const val PAPER = 0xFF1B1C20.toInt()
        private const val HIGHLIGHT = 0xFF25272C.toInt()
        private const val BAR = 0xFF16171A.toInt()
        private const val BODY = 0xFFD6D6D2.toInt()
        private const val ACCENT = 0xFF5DCAA5.toInt()
        /** 웹 등록 화면과 같은 문구 (EmployeeNewPage CONSENT_DECLINED) */
        private const val DECLINED = "동의하지 않으면 얼굴 등록을 할 수 없습니다. NFC 카드 등 다른 출입 수단을 안내해 주세요."
        /** 웹 ENROLLMENT_POSES와 같은 순서 */
        private val POSES = listOf(
            "정면을 봐 주세요",
            "정면을 한 번 더",
            "고개를 왼쪽으로 조금 돌려 주세요",
            "고개를 오른쪽으로 조금 돌려 주세요",
            "고개를 조금 들어 주세요",
            "고개를 조금 숙여 주세요",
        )
    }
}
