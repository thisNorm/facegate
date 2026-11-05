package com.example.facegate.face

/** Starting values for board calibration; cosine similarity is not a probability. */
data class FaceRecognitionConfig(
    val identityThreshold: Float = 0.40f,
    val detectionThreshold: Float = 0.40f,
    val nmsThreshold: Float = 0.40f,
    /**
     * 얼굴 찾기 입력 크기. 단말 앞 큰 얼굴(화면 높이 25% 이상)만 쓰므로 320이면 충분하다.
     * RK3576 측정: 640은 장면당 1.2초, 앱 CPU 49%, 320은 0.28초, 18% (2026-11-04)
     */
    val detectorInputSize: Int = 320,
    val minFaceHeightRatio: Float = 0.25f,
    val centerToleranceX: Float = 0.20f,
    val centerToleranceY: Float = 0.25f,
    val stableFrames: Int = 3,
    val maxFrameGapMs: Long = 1_500,
    val trackingIou: Float = 0.30f,
    val maxRollDegrees: Float = 15f,
    val maxNoseAsymmetry: Float = 0.25f,
    val minNoseVerticalRatio: Float = 0.20f,
    val maxNoseVerticalRatio: Float = 0.80f,
) {
    init {
        require(identityThreshold.isFinite() && identityThreshold in -1f..1f)
        require(detectionThreshold.isFinite() && detectionThreshold in 0f..1f)
        require(nmsThreshold.isFinite() && nmsThreshold in 0f..1f)
        require(detectorInputSize in 160..1280 && detectorInputSize % 32 == 0)
        require(minFaceHeightRatio.isFinite() && minFaceHeightRatio > 0 && minFaceHeightRatio <= 1)
        require(centerToleranceX.isFinite() && centerToleranceX in 0f..0.5f)
        require(centerToleranceY.isFinite() && centerToleranceY in 0f..0.5f)
        require(stableFrames in 2..3 && maxFrameGapMs > 0)
        require(trackingIou.isFinite() && trackingIou > 0 && trackingIou <= 1)
        require(maxRollDegrees.isFinite() && maxRollDegrees in 0f..45f)
        require(maxNoseAsymmetry.isFinite() && maxNoseAsymmetry in 0f..1f)
        require(minNoseVerticalRatio.isFinite() && maxNoseVerticalRatio.isFinite() &&
            minNoseVerticalRatio >= 0 && maxNoseVerticalRatio <= 1 && minNoseVerticalRatio < maxNoseVerticalRatio)
    }
}

internal data class DetectorOptions(val detectionThreshold: Float = 0.4f, val nmsThreshold: Float = 0.4f, val inputSize: Int = 640)
