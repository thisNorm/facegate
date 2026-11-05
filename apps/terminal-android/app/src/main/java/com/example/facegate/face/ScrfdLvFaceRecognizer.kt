package com.example.facegate.face

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.RectF
import android.os.SystemClock
import java.io.Closeable
import java.io.File

internal interface FaceInference : Closeable {
    fun detect(bitmap: Bitmap): List<Detection>
    fun embed(bitmap: Bitmap, detection: Detection): FloatArray
}

/** No camera, network, enrollment, UI, gate decisions or persistent embedding cache. */
class ScrfdLvFaceRecognizer internal constructor(
    private val engine: FaceInference,
    private val config: FaceRecognitionConfig,
    private val clock: () -> Long,
) : FaceRecognizer {
    constructor(modelDirectory: File, config: FaceRecognitionConfig = FaceRecognitionConfig()) : this(
        OnnxFaceEngine(modelDirectory, DetectorOptions(config.detectionThreshold, config.nmsThreshold, config.detectorInputSize)),
        config, SystemClock::elapsedRealtime,
    )

    private val policy = RecognitionPolicy(config)
    private var gallery: Map<Int, List<FloatArray>> = emptyMap()
    private var closed = false

    /** Serialized with recognize/close. Caller retains ownership of all input bitmaps. */
    @Synchronized
    override fun setGallery(faces: Map<Int, List<Bitmap>>) {
        check(!closed) { "Recognizer is closed" }
        policy.reset()
        // Invalidate retired/deleted identities even if a replacement fails to load.
        gallery = emptyMap()
        require(faces.keys.all { it > 0 }) { "Employee keys must be positive" }
        val next = mutableMapOf<Int, List<FloatArray>>()
        for ((key, photos) in faces.toSortedMap()) {
            val vectors = photos.mapNotNull { photo ->
                require(!photo.isRecycled && photo.width > 0 && photo.height > 0) { "Invalid reference bitmap" }
                // Tight face crops require context for SCRFD. No input-photo mutation.
                val padding = maxOf(photo.width, photo.height) / 2
                val reference = Bitmap.createBitmap(photo.width + padding * 2, photo.height + padding * 2, Bitmap.Config.ARGB_8888)
                try {
                    Canvas(reference).drawBitmap(photo, padding.toFloat(), padding.toFloat(), null)
                    val facesInPhoto = engine.detect(reference)
                    if (facesInPhoto.size != 1 || !policy.frontal(facesInPhoto.single().landmarks)) null
                    else FaceMath.normalize(engine.embed(reference, facesInPhoto.single()))
                } finally { reference.recycle() }
            }
            if (vectors.isNotEmpty()) next[key] = vectors
        }
        gallery = next
    }

    @Synchronized
    override fun recognize(frame: Bitmap): FaceResult? {
        check(!closed) { "Recognizer is closed" }
        try {
            require(!frame.isRecycled && frame.width > 0 && frame.height > 0) { "Invalid frame bitmap" }
            val capturedAt = clock()
            val selected = policy.select(engine.detect(frame), frame.width, frame.height, capturedAt) ?: return null
            val match = GalleryMatcher.match(engine.embed(frame, selected), gallery, config.identityThreshold)
            val b = selected.box
            return FaceResult(match.employeeKey, match.score, RectF(b.left, b.top, b.right, b.bottom))
        } catch (error: Exception) {
            policy.reset()
            throw error
        }
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        gallery = emptyMap()
        policy.reset()
        engine.close()
    }

    companion object {
        /** Run once on a worker thread; assets are copied into app-private files. */
        fun fromAssets(context: Context, config: FaceRecognitionConfig = FaceRecognitionConfig()): ScrfdLvFaceRecognizer =
            ScrfdLvFaceRecognizer(ModelFiles.install(context), config)
    }
}
