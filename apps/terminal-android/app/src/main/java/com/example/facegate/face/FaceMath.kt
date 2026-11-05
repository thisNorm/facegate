package com.example.facegate.face

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

internal data class Point(val x: Float, val y: Float)
internal data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float)
internal data class Detection(val box: Box, val confidence: Float, val landmarks: List<Point>)
/** Math ported from lvface_runtime.py and the SCRFD/InsightFace preprocessing. */
internal object FaceMath {
    val template = listOf(
        Point(38.2946f, 51.6963f), Point(73.5318f, 51.5014f),
        Point(56.0252f, 71.7366f), Point(41.5493f, 92.3655f), Point(70.7299f, 92.2041f)
    )

    fun normalize(vector: FloatArray): FloatArray {
        require(vector.isNotEmpty() && vector.all { it.isFinite() }) { "Invalid embedding" }
        val norm = sqrt(vector.sumOf { it.toDouble() * it })
        require(norm > 1e-12) { "Zero-norm embedding" }
        return FloatArray(vector.size) { (vector[it] / norm).toFloat() }
    }

    fun cosine(a: FloatArray, b: FloatArray): Float {
        require(a.size == b.size && a.isNotEmpty()) { "Embedding dimensions differ" }
        return a.indices.sumOf { a[it].toDouble() * b[it] }.toFloat().coerceIn(-1f, 1f)
    }

    fun iou(a: Box, b: Box): Float {
        // Source SCRFD uses inclusive pixel coordinates (+1).
        fun area(box: Box) = max(0f, box.right - box.left + 1) * max(0f, box.bottom - box.top + 1)
        val intersection = max(0f, min(a.right, b.right) - max(a.left, b.left) + 1) *
            max(0f, min(a.bottom, b.bottom) - max(a.top, b.top) + 1)
        val union = area(a) + area(b) - intersection
        return if (union > 0) intersection / union else 0f
    }

    fun nms(candidates: List<Detection>, threshold: Float): List<Detection> {
        val pending = candidates.sortedByDescending { it.confidence }.toMutableList()
        val kept = mutableListOf<Detection>()
        while (pending.isNotEmpty()) {
            val first = pending.removeAt(0)
            kept += first
            pending.removeAll { iou(first.box, it.box) > threshold }
        }
        return kept
    }

    /** Boundary-inclusive nose-in-eye/mouth polygon, matching the source pose gate. */
    fun frontal(points: List<Point>): Boolean {
        if (points.size != 5 || points.any { !it.x.isFinite() || !it.y.isFinite() }) return false
        val polygon = listOf(points[0], points[1], points[4], points[3])
        val nose = points[2]
        var inside = false
        var boundary = false
        var area = 0f
        for (i in polygon.indices) {
            val a = polygon[i]
            val b = polygon[(i + 1) % polygon.size]
            val cross = (b.x - a.x) * (nose.y - a.y) - (b.y - a.y) * (nose.x - a.x)
            if (abs(cross) < 1e-5f && nose.x in min(a.x,b.x)..max(a.x,b.x) &&
                nose.y in min(a.y,b.y)..max(a.y,b.y)) boundary = true
            if ((a.y > nose.y) != (b.y > nose.y) &&
                nose.x < (b.x - a.x) * (nose.y - a.y) / (b.y - a.y) + a.x) inside = !inside
            area += a.x * b.y - a.y * b.x
        }
        return abs(area) > 1e-8 && (boundary || inside)
    }

    /** Least-squares non-reflecting similarity: [a,-b,tx; b,a,ty]. */
    fun similarity(source: List<Point>, destination: List<Point> = template): DoubleArray {
        require(source.size == 5 && destination.size == 5)
        require((source + destination).all { it.x.isFinite() && it.y.isFinite() })
        val sx = source.sumOf { it.x.toDouble() } / 5
        val sy = source.sumOf { it.y.toDouble() } / 5
        val dx = destination.sumOf { it.x.toDouble() } / 5
        val dy = destination.sumOf { it.y.toDouble() } / 5
        var denominator = 0.0
        var dot = 0.0
        var cross = 0.0
        for (i in source.indices) {
            val x = source[i].x - sx; val y = source[i].y - sy
            val u = destination[i].x - dx; val v = destination[i].y - dy
            denominator += x * x + y * y
            dot += x * u + y * v
            cross += x * v - y * u
        }
        require(denominator > 1e-12) { "Degenerate face landmarks" }
        val a = dot / denominator; val b = cross / denominator
        require(a * a + b * b > 1e-12) { "Degenerate alignment transform" }
        return doubleArrayOf(a, b, dx - a * sx + b * sy, dy - b * sx - a * sy)
    }
}

