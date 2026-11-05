# 얼굴인식 스피드게이트 — 조사 노트 (2026-10-27)

## 1. 시장 대표 제품 한눈에

| 제품 | 핵심 특징 | 게이트 연동 방식 |
|---|---|---|
| Suprema BioStation 3 / FaceStation F2 (국산) | 0.2초 매칭, 인증거리 0.3~1.0m, 설치높이 1.4~1.9m, "멈추지 않고 통과" | 출입통제 패널(BioStar 2) 경유, 홈화면 배경/공지 커스터마이즈(800×1200) |
| Hikvision MinMoe (DS-K5671 = 턴스타일 전용 모듈) | 0.2초, 0.3~3m, 듀얼렌즈 위조방지(두 렌즈가 같은 사람을 봐야 통과) | 게이트에 Wiegand / RS-485 / IO 릴레이 출력 |
| Alcatraz AI Rock | 1초 이내, 얼굴만(1FA) 또는 카드+얼굴(2FA), **꼬리물기(tailgating) 탐지** + 스틸샷 로그 | 리더 자리에 끼워넣기: Wiegand / OSDP → 기존 출입통제 패널 |
| ZKTeco SpeedFace V5L | 5" 터치, 출입 이벤트 사진 캡처 | Wiegand 입·출력, 락/도어센서/퇴실버튼 |
| Dahua / DNAKE 안드로이드 단말 | Android 11(Dahua), 8" 화면, 라이브니스 | 턴스타일 파트너용, Wiegand/RS-485 |
| Boon Edam / Gunnebo (게이트 제조사) | 게이트 자체. 생체는 서드파티(IDEMIA 등)와 페어링 | 게이트는 "열림 신호"만 받음 |
| 네이버 1784 | 페이스사인으로 출입·결제·로그인 통합. 등록사진은 특징점 추출 후 파기 | 장비 사양 비공개 |

## 2. 공통 아키텍처 패턴

```
[카메라/단말] --얼굴--> [인식 서버 or 단말 내장 AI] --허가--> [출입통제 컨트롤러] --릴레이/Wiegand--> [스피드게이트]
                                                      \--> 로그/관리자 콘솔
```

- 게이트는 거의 항상 **"열어라" 신호만 받는 바보 장치**. 연동 표준은 Wiegand, OSDP, RS-485, 드라이 접점(릴레이).
- 우리 구조(별도 AI 서버 + 엣지)는 Alcatraz/Hikvision+HikCentral 패턴과 같음.
- 보안 권장: 단말이 부서져도 문이 열리지 않게 **제어 신호는 안쪽(보안구역) 컨트롤러에서** 출력 (Hikvision이 RS-485 보안 도어유닛을 쓰는 이유).

## 3. 단말 화면 UX 공통 요소

- 대기 화면: 시계, 회사 로고/공지, "카메라를 봐주세요" 가이드
- 얼굴 가이드 프레임 + 거리 안내(가까이/멀리)
- 결과: 초록(이름 + "환영합니다") / 빨강(미등록·권한없음) — 0.2~1초 안에 끝나야 함
- 라이브니스(사진/영상 위조 방지) 실패 시 재시도 안내
- 꼬리물기 경고, 마스크/안경 대응
- 출입 이벤트 사진 로그

## 4. 아직 모르는 것 (인터뷰로 채울 것)

1. 안드로이드 앱의 역할 (게이트 옆 단말? 관리자? 직원 등록?)
2. 하드웨어: 어떤 안드로이드 기기, 카메라, 게이트 제조사/모델
3. AI 서버 API: 사진 전송? 특징벡터? 응답 형식, 지연시간
4. 게이트 열림 신호를 누가 보내나 (앱 → 릴레이 / 서버 → 컨트롤러)
5. 인원·처리량(출근 피크 분당 몇 명), 게이트 수
6. 실패 시 대안: 사원증 카드, QR, 방문객
7. 라이브니스는 서버에서? 단말에서?
8. 네트워크 끊김 시 동작 (fail-safe/fail-secure)
9. 개인정보: 얼굴 데이터 저장 위치, 동의, 보존 기간
10. 기존 엣지서버와의 관계, 기존 출입통제 시스템(ex. 캡스/에스원) 연동 여부

## 5. 인터뷰 답변

- Q1 앱 역할 → **세 가지 다**: ① 게이트 앞 얼굴인식(통과해야 문 열림) ② 사내 관리자 시스템 ③ 직원 얼굴 전원 등록
  - 하위 프로젝트 3개로 나눠서 순서대로 진행 (단말 → 등록 → 관리자 순 제안)
- Q2 관리자 위치 → **웹 관리자(PC 브라우저) + 안드로이드 게이트 단말 앱**. 얼굴 등록은 웹(웹캠/사진 업로드) 또는 단말 관리자 모드
- Q3 게이트 제어 → 업체는 **시공·배선만** 해줌. **열림 신호(와 닫힘 처리)는 우리 시스템이 보내야 함**. 방식(서버 vs 단말)은 미정
  - 참고: 스피드게이트는 보통 "열림 펄스(드라이 접점)" 하나만 받고, 사람이 지나가면 센서로 **알아서 닫힘**. 닫힘을 우리가 따로 보내야 하는지 업체에 확인 필요
  - 후보: 엣지서버 → 네트워크 릴레이 모듈(이더넷 릴레이) → 게이트 입력 단자
- Q4 게이트 사양 → **아직 선정 전**. 아래 체크리스트로 선정

### 게이트 선정 시 업체에 꼭 물어볼 것
1. 열림 입력 방식: 드라이 접점(무전압 접점) 지원? (가장 범용, 우리가 릴레이로 쉽게 제어) / RS-485 / TCP 명령 프로토콜 문서 제공?
2. 방향별 입력: 입장·퇴장 열림 신호가 따로 있나?
3. 자동 닫힘: 통과 감지 후 자동 닫힘? 열림 후 미통과 시 타임아웃(몇 초, 설정 가능?)
4. 출력 신호: "통과 완료", "꼬리물기/역진입 경보" 접점 출력 있나? (출입 로그 정확도에 필요)
5. 정전·화재 시: 자동 개방(fail-safe) 지원 + 화재수신반 연동
6. 단말 거치: 게이트 상판에 안드로이드 단말(8~10") 브라켓/배선 홀 있나?
7. 처리량: 분당 통과 인원, 휠체어·짐 통과용 광폭 레인
8. 원격 열기(관리자 수동 개방) 방법

- Q5 AI 서버 → **기존 엣지 서버가 쓰는 것과 같은 AI 서버**. API 형식은 기존 엣지서버 코드에서 확인 예정

## 출처
- [Suprema BioStation 3 datasheet](https://www.supremainc.com/uploadfiles/Marketing_Materials/[SUPREMA-AHL-BS3-DE-REV04](2).pdf)
- [FaceStation F2 home screen config](https://support.supremainc.com/support/solutions/articles/24000071252--biostar-2-facestation-f2-home-screen-configuration)
- [Hikvision Face Recognition & Turnstile leaflet](https://www.hikvision.com/content/dam/hikvision/en/brochures-download/product-brochures/access-control/Face-Recognition-and-Turnstile-Solutions-Leaflet.pdf)
- [Hikvision DS-K5671 turnstile module](https://www.hikvision.com/it/products/Access-Control-Products/Face-Recognition-Terminals/Face-Recognition-Modules-for-Turnstile/ds-k5671-zu)
- [Alcatraz Rock](https://www.alcatraz.ai/prebuilt-pages-v2/rock), [tailgating detection](https://securitysales.com/news/alcatraz-tailgating-detection/128776)
- [ZKTeco SpeedFace V5L](https://www.zkteco.com/en/SpeedFaceSeries/SpeedFace-V5L-Series)
- [DNAKE 905K-Y3](https://www.dnake-global.com/905k-y3-android-facial-recognition-terminal-product/)
- [Boon Edam speed gate integrations](https://blog.boonedam.com/en-gb/speed-gate-advanced-integrations)
- [네이버 페이스사인 / 1784](https://www.itworld.co.kr/article/3561677/)
