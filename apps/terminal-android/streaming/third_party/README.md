# third_party

`src/main/java/com/pedro/rtspserver/**` (Kotlin 17개)는 [RTSP-Server](https://github.com/pedroSG94/RTSP-Server)
태그 1.4.3 (커밋 3b54a59)의 `rtspserver/src/main/java`를 패키지 이름 그대로 복사한 것이다. 라이선스: Apache-2.0 (`RTSP-Server-LICENSE`).

변경 사항 (`패치:` 주석으로 표시):
- `server/ServerCommandManager.kt`: Basic 인증을 DESCRIBE만이 아니라 OPTIONS를 뺀 모든 요청에 요구.
- `server/RtspServer.kt`: `stopServer()` 직후 `startServer()`가 와도 새 서버 job이 취소되지 않게 이전 job을 지역 변수로 잡아 취소.
