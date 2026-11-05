# FaceGate AI 프로그램 (개발 PC / RTX) 설정 가이드

Task 11: Jetson 대신 개발 PC(RTX 4060 Laptop)에서 기존 얼굴인식 AI를 게이트 서버에 연결하기 위한 환경 구성 기록.
AI 사본 위치: `C:\Users\<사용자>\FaceGate_AI` (FaceGate git 저장소 밖, 커밋 안 함).

## 1. 복사 내역

원본: Jetson `100.100.40.84:~/Face_Recognition_API_tensorRT_main` (읽기 전용으로만 접근, tar 스트림 복사).

| 복사함 | 비고 |
|---|---|
| `app/ scripts/ tests/ config/ docs/ deploy/ run.sh AGENTS.md CHANGELOG.md` 및 루트 `*.py` | 코드 |
| `environments/rtx.yml` | 의존성 정의 참고용 |
| `models/det_10g.onnx` (17 MB) | SCRFD 얼굴 검출 (ONNX Runtime GPU) |
| `vendor/facemoe/{backbones,face_pipeline,easydict.py,LICENSE*,README.md,source_manifest.json}` | FaceMoE 런타임 소스 |
| `vendor/facemoe/weights/swin4m_exp_3_k_2_briar_full/model.pt` (1.8 GB) | FaceMoE PyTorch 체크포인트 |

제외: `data/`, `api_logs/`, `.miniforge/`, `__pycache__`, `vendor/lvface`, `*.engine`, `environments/wheels`(aarch64), `models/facemoe_briar_full*.onnx(.data)`, `vendor/facemoe/swin4m_exp_3_k_2_briar_full/`(중복 model.pt, TensorRT engine, ONNX).

**중요 발견 (지시서와 다른 점):** `facemoe_briar_full_fp16.onnx`는 코드 어디에서도 로드되지 않는다. `face_pipeline/facemoe.py`는 `.engine`(TensorRT, Jetson 전용) 또는 `.pt`(PyTorch + timm)만 지원한다. 따라서 RTX 경로는 **PyTorch `model.pt`** 를 쓰며, FaceMoE ONNX(수 GB)는 복사하지 않았다. 슈퍼바이저 진입점은 `run.sh`가 쓰는 `video_test_request_send_combined.py`(자식: `video_test_multi_stream_face_combined_api.py`)이다. `tests/legacy/...`는 원본에 존재하지 않는다.

## 2. Windows 개발 PC 설정

```powershell
cd C:\Users\<사용자>\FaceGate_AI
uv venv --python 3.11 .venv
uv pip install --python .venv\Scripts\python.exe numpy opencv-python pyyaml requests scikit-image pandas timm "onnxruntime-gpu" `
    torch torchvision --index-url https://download.pytorch.org/whl/cu130 --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match
```

설치된 주요 버전: Python 3.11.15, torch 2.14.1+cu130, torchvision 0.29.1+cu130, onnxruntime-gpu 1.31.1, timm 1.0.19, opencv-python 4.11.0.86, numpy 2.4.6, scikit-image 0.26.0, pyyaml 6.0.3, requests 2.34.2.

**CUDA DLL 처리:** onnxruntime-gpu 1.31은 CUDA 13 + cuDNN 9로 빌드되어 있다. CUDA Toolkit 설치나 `nvidia-*-cu12` pip 패키지는 필요 없다. torch(cu130) 휠이 CUDA 13/cuDNN DLL을 포함하고, **onnxruntime보다 먼저 `import torch`** 하면 ORT가 그 DLL을 그대로 사용한다. 이를 보장하려고 `app/facemoe_runtime.py`에 `import torch`를 추가했다(검출기 SCRFD가 torch import 전에 생성되기 때문). cu126 torch를 쓰면 ORT가 `cublasLt64_13.dll` 누락으로 CPU로 떨어지므로 반드시 cu130.

## 3. 실행

게이트 서버에 관리자로 로그인(쿠키)한 뒤 키를 발급받는다(발급 시 1회만 표시). 받은 키를 환경변수로 넣고, 키를 파일에 저장하지 말 것.

```bash
curl -c cookie.txt -H "Content-Type: application/json" -d '{"loginId":"hr.kim","password":"..."}' http://localhost:8080/api/admin/auth/login
curl -b cookie.txt -X POST http://localhost:8080/api/admin/settings/ingest-key
```

```powershell
cd C:\Users\<사용자>\FaceGate_AI
$env:PYTHONUTF8 = "1"
$env:OPENCV_FFMPEG_CAPTURE_OPTIONS = "rtsp_transport;tcp"  # Windows: 실행 중 설정한 값을 OpenCV FFmpeg DLL이 못 읽어 시작 전에 지정
$env:FACEGATE_INGEST_KEY = "<발급받은 키>"
# 사전 점검 (모델 미로딩)
.\.venv\Scripts\python.exe scripts\check_facemoe_runtime.py --config config\conf_api.gate.yaml --runtime-profile rtx --verbose
# 본 실행 (run.sh의 Windows 등가)
New-Item -ItemType Directory -Force data\runtime\log_facegate | Out-Null
.\.venv\Scripts\python.exe video_test_request_send_combined.py --config config\conf_api.gate.yaml --runtime-profile rtx --verbose
```

주의: 사전 점검은 `BASE_DATASET`(`data/base_imageset/facegate/<인물명>/*.jpg`)에 등록 이미지가 1장 이상 있어야 통과한다. 현재는 빈 디렉터리다(서버의 `/face/dataset` 동기화로 채워지거나 수동 등록). `RUNTIME_PROFILE`은 config(`rtx`)와 `--runtime-profile rtx` 인자 양쪽으로 지정되며, 인자가 우선한다.

## 4. 게이트 설정 (`conf_api.gate.yaml`, 첨부 사본 참고)

- URL `http://127.0.0.1:8080`, CCTV_ID `facegate_ai01`, FARM_ID `facegate`
- 10 fps(`FRAME_DETECT_PER_SECOND: 10`), 2회 연속 일치 확정(`EVENT_CONFIRMATION_MATCHES: 2`), 대기 3초(`WAIT_TIME_SEC: 3`), 로그 전송 폴링 0.1초
- `DISTANCE_THRESHOLD: 0.4` 유지, `LABEL_NAME: []`
- `BASE_DATASET: data/base_imageset/facegate`, `UNKNOWN_EMBEDDINGS_PATH: data/runtime/unknown_data_facegate.json`, `SERVER_UPLOAD_PATH: data/runtime/log_facegate`
- 지시 외 변경(RTX에서 필수): `FACEMOE_MODEL: weights/swin4m_exp_3_k_2_briar_full/model.pt`, `FACE_DET_MODEL: models/det_10g.onnx` (원본은 Jetson TensorRT engine)
- `CCTV_LIST`는 `{}`로 비웠다(원본의 Jetson 카메라 RTSP 자격증명 제거). 카메라 목록은 게이트 서버 `GET /rtsp`에서 받는다.
- 개발 PC 연동 시험에서는 게이트 서버를 18080 포트로 띄워 `URL: http://127.0.0.1:18080`을 썼다(8080은 이 PC의 다른 프로그램이 사용 중).

## 5. AI 사본 코드 변경 (Jetson에 나중에 적용할 diff 요약)

`video_test_request_send_test.py`
- `JSON_HEADERS`: `"X-Ingest-Key": os.environ["FACEGATE_INGEST_KEY"]` 추가. 세션(`_build_session`의 `s.headers.update(JSON_HEADERS)`)이 모든 요청(POST appear/disappear, GET /rtsp, /face/dataset, /file 이미지 다운로드)에 적용한다. 환경변수 미설정 시 KeyError로 즉시 종료.
- `interval_log = timedelta(seconds=2)` → `timedelta(milliseconds=100)  # 게이트: 확정 즉시 전송에 가깝게`
- Windows: `start_child` 비-POSIX 분기에서 `stdout/stderr=PIPE` 제거. 파이프 fd를 `os.dup`해 spawn된 reader 프로세스에 넘기는 방식은 Windows에서 불가. 자식 로그는 콘솔로 직접 출력된다(`[STDOUT]` 접두사 없음).
- Windows: `stop_child` 비-POSIX 분기를 `proc.terminate()` 대신 `taskkill /T /F /PID`로 변경(자식이 spawn한 카메라 워커 고아 방지).

`app/shared_memory_cleanup.py`
- `cleanup_shared_memory`: `os.name != "posix"`이면 0 보고서를 즉시 반환 (`/dev/shm`, `/proc`, `os.getuid` 의존).

`video_test_multi_stream_face_combined_api.py`
- 이벤트 파일 이름의 시각에서 `:`를 `-`로 바꿈(6곳). Windows는 파일 이름에 `:`를 못 써서 감지 사진 저장이 실패함. 파일 안의 `appear_time` 값은 그대로.

`config/conf_api.gate.yaml`
- `BASE_DATASET: data/base_imageset/all_together_api`. 슈퍼바이저(`video_test_request_send_test.py`의 `DATASET_ROOT`)가 서버에서 받은 등록 사진을 이 경로에 고정으로 저장하므로 인식기도 같은 경로를 읽어야 함.

`app/event_results.py`
- `fcntl`을 선택적 import로 변경. Windows에는 없어서 자식 프로세스가 시작하자마자 죽음. 없으면 파일 잠금 생략(쓰는 프로세스가 하나).

`app/shared_memory_cleanup.py` `process_identity`
- Windows(`os.name == "nt"`)면 `("R", 0)` 반환. `/proc/<pid>/stat`이 없어 카메라 큐 생성 시 죽음. PID 재사용 검사는 생략.

`app/facemoe_runtime.py`
- `import torch` 추가 (ORT-GPU가 torch의 CUDA DLL을 찾도록; Windows 전용 의도이나 Linux에서도 무해).

기타 Linux 전용 코드(`signal.SIGKILL/killpg`, `mp "fork"`)는 이미 `_posix()` 분기로 보호되어 있어 수정하지 않았다. 자식 스트림 워커는 이미 `spawn` 컨텍스트를 쓴다.

## 6. 검증 결과 요약

- `check_facemoe_runtime.py --runtime-profile rtx`: `passed: true` (임시 갤러리 1장으로 확인)
- 스모크: SCRFD가 `CUDAExecutionProvider`, FaceMoE가 `cuda:0`에서 실행. 샘플 얼굴 1개 검출(score 0.84), 512차원 L2 정규화 임베딩 생성, 검출 약 12 ms/프레임.
- 게이트 서버 연동(2026-10-28, 개발 PC + WA8059T 단말): 관리자 API로 발급한 키로 `GET /rtsp`·`/face/dataset`(204, 등록 없음)·`power-on`·1분 주기 `status`(`rtsp_ok: true`) 모두 200. 단말 RTSP를 TCP로 수신.
- 얼굴 인식 시험(2026-10-28): 시험 직원 1명(단말 카메라로 찍은 사진 3장)을 등록하자 AI가 `/file`로 사진을 받아 갤러리에 반영, 단말 앞에 서자 `appear` → 서버 판정 `GRANTED` 2건, 단말에 환영 화면 표시. AI 감지 시각(`appear_time`)에서 문 열림까지 약 1~2초.
- AI를 다시 띄울 때 이전 프로세스가 남지 않게 할 것. 여러 개가 겹치면 단말에 RTSP 연결이 쌓이고 메모리 부족으로 영상 디코딩이 실패함.
- 단말 RTSP 서버는 TCP만 허용한다(UDP SETUP은 461 → 클라이언트가 TCP로 재시도). adb 포트 포워딩·방화벽 환경에서도 동작하고 영상 손실이 없다.
- onnxruntime 로드 시 `No registered plugin EP device found for 'CUDAExecutionProvider'` 경고가 출력되나 세션 provider는 `CUDAExecutionProvider`로 확인됨(무시 가능).
