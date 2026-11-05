# FaceGate 단말 앱 (Android)

WA8059T(Android 14) 키오스크 단말. 전면 카메라를 RTSP(포트 8555, Basic 인증)로 AI 서버에 송출하고, 게이트 서버와 WebSocket으로 판정 결과를 받는다. 8554 포트는 단말에 기본 설치된 IP 카메라 앱(`com.ipcam`)이 쓰고 있어 8555를 사용한다.

- `app`: 화면, 설정, WebSocket, 크래시 재실행
- `streaming`: RTSP 송출. RTSP-Server 1.4.3 소스를 인증 패치와 함께 포함 (`streaming/third_party/README.md`)

## 빌드

JDK 17 필요.

```sh
cd apps/terminal-android
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot"
./gradlew :app:testDebugUnitTest :streaming:testDebugUnitTest assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`

## 설치와 단말 1회 설정

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant com.example.facegate android.permission.CAMERA
# 크래시 후 자동 재실행에 필요 (Android 14 백그라운드 시작 제한). 앱을 제거했다 다시 설치하면 다시 실행
adb shell appops set com.example.facegate SYSTEM_ALERT_WINDOW allow
adb shell am start -n com.example.facegate/.MainActivity
```

## 키오스크 (FR-T-06)

현장 단말은 설치할 때 한 번 기기 소유자로 등록한다. 단말에 계정이 없어야 등록된다. 등록되면 홈 앱 고정(부팅하면 바로 뜸), 화면 고정(홈, 최근 앱, 알림 막대 막음), 잠금 화면 끔, 충전 중 화면 켜짐, 카메라 권한 허용이 저절로 켜진다. 등록하지 않으면 지금처럼 평소 앱으로 돈다.

```sh
adb shell dpm set-device-owner com.example.facegate/.KioskAdmin
```

점검은 관리자 모드의 "단말 설정 열기"(화면 고정을 풀고 안드로이드 설정, 홈 버튼으로 돌아오면 다시 잠김). 등록된 동안 `adb uninstall`은 안 되고 `adb install -r`은 된다. 개발용 빌드는 `adb shell am start -n com.example.facegate/.MainActivity --es preview KIOSK_OFF`로 모두 풀고 소유자에서 빠진다. 그 기능이 없는 빌드만 남으면 공장 초기화해야 풀린다.

## 핸드폰으로 열기 (D-62)

서버에 `PHONE_BASE_URL`이 있으면 단말이 20초마다 일회용 주소를 받아 NFC 태그로 내보내고(HCE, `PassTag.kt`), 평소 화면에 "QR로 열기" 버튼이 생긴다. 단말 NFC가 켜져 있어야 한다. 확인: `adb shell dumpsys nfc | grep PassTag`.

## 단말 안 얼굴 인식 (D-63)

관리자 웹 설정 '얼굴 인식 위치'를 단말로 바꾸면 1분 안에 켜진다(`FaceGate.kt`, 인식 코드는 `face/`, AI팀 전달본). 모델 두 개는 git에 없으니 `app/src/main/assets/models/`에 `det_10g.onnx`, `LVFace-T_Glint360K.onnx`를 넣고 빌드한다. 처음 켤 때 모델을 앱 안으로 복사해서 몇 초 걸린다. 관리자 모드 동안은 멈춘다. 로그: `adb logcat -s FaceGate | grep -E "gallery|appear"`.

**속도는 릴리스 빌드로 잰다.** 개발용(디버그) 빌드는 사진을 숫자로 바꾸는 부분이 몇 배 느려 장면 하나에 수 초가 걸린다. 운영 단말에는 릴리스 빌드를 깔아야 한다(서명 키는 아직 없음).

## 연결 (D-57)

단말에서는 아무것도 입력하지 않는다. 연결 정보가 없으면 미연결 화면이 나오고, 관리자 웹 **게이트** 화면의 **단말 추가**에서 둘 중 하나로 연결한다.

- QR: 웹에 나온 QR을 단말 카메라(화면 오른쪽 사각형)에 30~50cm 거리로 비춘다.
- 번호: 미연결 화면 아래의 단말 주소와 6자리 연결 번호를 웹 창 아래쪽에 입력한다. 서버가 단말의 8556 포트로 연결 정보를 보낸다.

연결되면 서버가 만든 토큰과 RTSP 계정이 저장되고 판정·송출 화면으로 바뀐다. 웹에서 연결 해제하면 미연결 화면으로 돌아온다. 연결된 뒤 화면을 길게 누르면 연결 정보 보기와 다시 연결이 있다.

개발 PC와 단말을 USB로 연결해 쓸 때(망이 달라도 됨):

```sh
adb reverse tcp:18080 tcp:18080   # 단말 → 서버 (서버 포트에 맞춤)
adb forward tcp:8555 tcp:8555     # 서버 → 단말 RTSP
adb forward tcp:8556 tcp:8556     # 서버 → 단말 번호 창구 (번호 연결 때 웹에 단말 주소 127.0.0.1)
```

## RTSP 주소

`rtsp://<사용자>:<비밀번호>@<단말 IP>:8555/` (경로는 루트). 계정은 연결 때 서버가 만들고, 단말 IP는 단말이 접속할 때 서버가 닿는 주소로 정한다.

## 단말 확인

```sh
adb logcat -d | grep -iE "AndroidRuntime|com.example.facegate"
ffprobe -rtsp_transport tcp "rtsp://<RTSP 사용자>:<비밀번호>@<단말 IP>:8555/"   # h264 1920x1080 15fps
ffprobe -rtsp_transport tcp "rtsp://<단말 IP>:8555/"                  # 401 Unauthorized
# DESCRIBE 없이 SETUP/PLAY만 보내도 401이어야 함
printf 'SETUP rtsp://<단말 IP>:8555/streamid=0 RTSP/1.0\r\nCSeq: 1\r\nTransport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n\r\n' | nc <단말 IP> 8555
printf 'PLAY rtsp://<단말 IP>:8555/ RTSP/1.0\r\nCSeq: 2\r\n\r\n' | nc <단말 IP> 8555
# 크래시 재실행: 3초 뒤 앱이 다시 떠야 함
adb shell am crash com.example.facegate
```
