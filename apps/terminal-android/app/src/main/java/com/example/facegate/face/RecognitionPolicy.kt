package com.example.facegate.face

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

/** Eligibility and geometric track continuity, with no identity inference or Android state. */
internal class RecognitionPolicy(private val config: FaceRecognitionConfig) {
    private var previous: Box? = null
    private var count = 0
    private var lastAt = 0L
    private var width = 0
    private var height = 0

    fun select(detections: List<Detection>, frameWidth: Int, frameHeight: Int, now: Long): Detection? {
        require(frameWidth > 0 && frameHeight > 0)
        val face = detections.filter { eligible(it, frameWidth, frameHeight) }
            .maxByOrNull { (it.box.right - it.box.left) * (it.box.bottom - it.box.top) }
        if (face == null) { reset(); return null }
        val continuous = previous?.let { FaceMath.iou(it, face.box) >= config.trackingIou } == true &&
            now >= lastAt && now - lastAt <= config.maxFrameGapMs && width == frameWidth && height == frameHeight
        count = if (continuous) minOf(count + 1, config.stableFrames) else 1
        previous = face.box; lastAt = now; width = frameWidth; height = frameHeight
        return face.takeIf { count >= config.stableFrames }
    }

    fun reset() { previous = null; count = 0; lastAt = 0; width = 0; height = 0 }

    private fun eligible(face: Detection, w: Int, h: Int): Boolean {
        val b = face.box
        if (!listOf(b.left, b.top, b.right, b.bottom, face.confidence).all { it.isFinite() } ||
            face.confidence < config.detectionThreshold || b.left < 0 || b.top < 0 ||
            b.right > w || b.bottom > h || b.right <= b.left || b.bottom <= b.top) return false
        return b.bottom - b.top >= h * config.minFaceHeightRatio &&
            abs((b.left + b.right) / 2 - w / 2f) <= w * config.centerToleranceX &&
            abs((b.top + b.bottom) / 2 - h / 2f) <= h * config.centerToleranceY && frontal(face.landmarks)
    }

    /** Conservative five-point pose proxy, not calibrated yaw/pitch or liveness. */
    fun frontal(points: List<Point>): Boolean {
        if (!FaceMath.frontal(points)) return false
        val left = points[0]; val right = points[1]; val nose = points[2]
        val dx = right.x - left.x; val dy = right.y - left.y
        if (dx <= 1e-4f) return false
        if (abs(Math.toDegrees(atan2(dy.toDouble(), dx.toDouble()))) > config.maxRollDegrees) return false
        val eyeDistance = hypot(dx, dy)
        val ux = dx / eyeDistance; val uy = dy / eyeDistance
        val noseX = (nose.x - left.x) * ux + (nose.y - left.y) * uy
        if (abs(2 * noseX / eyeDistance - 1) > config.maxNoseAsymmetry) return false
        val mouthX = (points[3].x + points[4].x) / 2
        val mouthY = (points[3].y + points[4].y) / 2
        val mouthVertical = -(mouthX - left.x) * uy + (mouthY - left.y) * ux
        val noseVertical = -(nose.x - left.x) * uy + (nose.y - left.y) * ux
        if (mouthVertical <= 1e-4f) return false
        return noseVertical / mouthVertical in config.minNoseVerticalRatio..config.maxNoseVerticalRatio
    }
}

internal data class IdentityMatch(val employeeKey: Int?, val score: Float)

internal object GalleryMatcher {
    fun match(query: FloatArray, gallery: Map<Int, List<FloatArray>>, threshold: Float): IdentityMatch {
        val normalized = FaceMath.normalize(query)
        var bestKey: Int? = null
        var bestScore = -Float.MAX_VALUE
        for ((key, references) in gallery.toSortedMap()) for (reference in references) {
            val score = FaceMath.cosine(normalized, reference)
            if (score > bestScore) { bestScore = score; bestKey = key }
        }
        if (bestKey == null) return IdentityMatch(null, 0f)
        return IdentityMatch(bestKey.takeIf { bestScore >= threshold }, bestScore)
    }
}
