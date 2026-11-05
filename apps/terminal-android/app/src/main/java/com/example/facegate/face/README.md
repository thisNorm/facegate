# SCRFD + LVFace-T recognition handoff

Implements section 3 of `FaceGate/AI_연동_안내.md` with the exact public
`FaceRecognizer` and `FaceResult` types. The implementation is
`ScrfdLvFaceRecognizer`. Existing MainActivity, TerminalSocket, AdminPanel,
StreamController, layouts, pairing and gate behavior are unchanged.

## Integration (receiving team's responsibility)

Unzip the code archive into the FaceGate root. Unzip the separate model archive
into the same root; it places two ignored ONNX files at:

- `apps/terminal-android/app/src/main/assets/models/det_10g.onnx`
- `apps/terminal-android/app/src/main/assets/models/LVFace-T_Glint360K.onnx`

Run construction, gallery replacement, recognition and close on a worker thread.
Methods are synchronized, but calling them on the UI/GL thread can block rendering.
The caller owns every supplied Bitmap and can recycle gallery photos after
setGallery returns. Live frame bitmaps must remain valid until recognize returns.
No input bitmap is recycled or modified by the recognizer.

```kotlin
// Worker thread, once. fromAssets copies verified bytes to app-private files.
val recognizer: FaceRecognizer = ScrfdLvFaceRecognizer.fromAssets(context)
// Alternatively: ScrfdLvFaceRecognizer(directoryContainingBothOnnxFiles)

// Worker thread: call again after employee additions, changes, retirement or deletion.
recognizer.setGallery(mapOf(employeeKey to referenceBitmaps))

// StreamController.snapshot callback runs on GL: hand each Bitmap to one worker.
// Do not enqueue an unbounded frame backlog. Call on upright, unmirrored source
// frames at roughly 500 ms intervals, retaining original snapshot coordinates.
val result: FaceResult? = recognizer.recognize(frame)
if (result != null) {
    // employeeKey == null: qualified person, no gallery score above threshold.
    // Forward to your existing gate-server integration. Do not open the door here.
}

// Worker thread when no further calls can arrive.
recognizer.close()
```

Construct the worker and recognizer once rather than once per frame. Missing or
incompatible models throw an exception; initialization failure is not an unknown
identity. A closed recognizer rejects later use. Repeated close is harmless.
fromAssets compares SHA-256 with packaged bytes before reusing private model files;
no gallery/embedding cache or live enrollment is created.

## Eligibility and result semantics

`recognize(frame)` returns null until all conditions hold on 3 consecutive calls:
face height at least 25% of frame height; centre within +/-20% frame width and
+/-25% frame height of the image centre; frontal landmark geometry; and the
largest eligible face has bounding-box IoU >=0.30 across observations. A missing
eligible face, resolution change, backwards clock or gap over 1500 ms resets
stability. Exceptions also reset it. Configure `stableFrames=2` for two frames.
These are frame-count checks requested by this guide, not a fixed two-second wait.
A stable face can return on subsequent calls; the host manages event deduplication.

Frontal checks use five landmarks: nose within the eye/mouth polygon, eye-line
roll <=15 degrees, horizontal nose asymmetry <=0.25 and nose vertical position
between 0.20 and 0.80 of the eye-to-mouth distance. This is a geometric pose proxy,
not calibrated yaw/pitch estimation or liveness detection. Distance, centre and
pose settings are exposed in `FaceRecognitionConfig`; calibrate on the RK3576.
IoU continuity is not proof of identity if people rapidly exchange positions.
The guide is visually symmetric: source-frame boxes remain in source pixels;
the host must mirror/map boxes when drawing over a mirrored camera preview.

Only explicitly provided reference photos supply identities. Each photo must
contain exactly one detected frontal face; no near/centre/stability restriction
is imposed on enrollment photos. Tight crops are padded with black context before
SCRFD, then aligned from the same padded pixels. Invalid/multi-face/pose-rejected
photos are skipped. setGallery replaces the entire gallery and resets stability;
an empty gallery returns employeeKey=null after a live face qualifies. Unhandled
loading/inference failures clear the old gallery rather than retaining stale IDs.
A supplied recycled reference Bitmap throws. IDs must be positive integers.

`score` is the maximum cosine similarity across all accepted employee references,
including when below the identity threshold. For an empty gallery it is 0.0 by
convention. It is not a probability. Boxes are copied to a new RectF in input
frame pixels. The camera, gallery HTTP downloads, /appear, /disappear, /status,
and access-decision WebSocket remain outside this component, as assigned to the
receiving team in the guide. No automatic application wiring or debug screen was
added: simply installing the APK does not start this recognizer.

## Model specifications

| Property | SCRFD-10G | LVFace-T Glint360K |
|---|---|---|
| Filename | det_10g.onnx | LVFace-T_Glint360K.onnx |
| Runtime | ONNX Runtime Android 1.24.3, CPU | Same |
| Input | FP32 NCHW [1,3,640,640] | FP32 NCHW [1,3,112,112] |
| Channels | RGB | RGB |
| Resize/alignment | Aspect-preserving bilinear resize; black right/bottom padding to 640 | Five-landmark similarity alignment to ArcFace 112 template; bilinear warp, black borders |
| Pixel normalization | (channel - 127.5) / 128.0 | (channel - 127.5) / 127.5 |
| Outputs | 9 tensors: scores, boxes, 5 landmarks at strides 8/16/32; two anchors/cell | One 512-D embedding; L2 normalize before matching |
| Starting threshold | Detection confidence 0.40, NMS IoU 0.40 | Maximum-reference cosine 0.40 |

The exact 112-pixel landmark template is in FaceMath.kt. The supplied detector
allows dynamic image axes; `FaceRecognitionConfig.detectorInputSize` picks the square
size (FaceGate default 320, 640 above means the original setting). LVFace-T
allows dynamic batch but only batch=1 is used. Metadata, sizes and SHA-256 hashes
are in MODEL_MANIFEST.json. Android Bitmap inputs must be upright ARGB_8888 or
other CPU-readable software Bitmaps; the caller handles EXIF/camera rotation.
Hardware-backed Bitmaps are not supported by getPixels/Canvas preprocessing.

The thresholds are initial values, not a measured access-control operating point.
Validate false accepts/rejects, pose/size limits, memory and latency on the actual
board and site data. CPU support is retained for the emulator. No RKNN dependency,
NPU acceleration, CUDA, TensorRT, network inference or automatic enrollment exists.

## Model licensing: production approval is NOT supplied

As checked on 2026-11-04, both upstream projects distinguish MIT source code from
non-commercial-research-only pretrained weights:

- SCRFD/InsightFace: https://github.com/deepinsight/insightface#license
- LVFace: https://github.com/bytedance/LVFace#license
- Official LVFace-T weight listing: https://huggingface.co/bytedance-research/LVFace/tree/main/LVFace-T_Glint360K

Therefore these supplied weights must not be represented as approved for company
access-control operation. Obtain explicit suitable rights from the model owners,
or replace/retrain using appropriately licensed models/data. Merely using the
software internally or retaining the MIT code licence does not establish rights
to deploy these weights. File hashes identify the local copies; they do not prove
a separate commercial grant. No such grant was found or included in this handoff.

## Verification

With JDK 17 and Android SDK 37 installed:

```sh
./gradlew :app:testDebugUnitTest :streaming:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
```

If the supplied gradlew is not executable or has Windows line endings, use an
installed Gradle 9.8.2 with `-p apps/terminal-android`; no original launcher file
is changed in the handoff. Use your local Android SDK environment/path.

On a connected emulator after models have been installed as assets:

```sh
./gradlew :app:connectedDebugAndroidTest
```

Alternatively install the app and test APK, put both ONNX files into an app-readable
directory and run instrumentation with `-e faceModelDir <directory>`. The test
runner is androidx.test.runner.AndroidJUnitRunner. FaceRecognizerContractTest
uses a fake backend to test real Bitmap/API semantics, gallery replacement and
that live embeddings wait for stability. OnnxModelSmokeTest executes the actual
SCRFD and LVFace-T on synthetic pixels, checking finite 512-D normalized output;
it is not an accuracy, live-camera or door-control test. JVM tests cover eligibility,
pose proxies, stability resets, largest-face selection, matching and alignment.

The changed-files ZIP excludes build outputs, .gradle, local.properties,
AGENTS.md, IDE/AI settings, model weights and private reference datasets. Models
are delivered separately. See VALIDATION.txt for checks actually executed here.
