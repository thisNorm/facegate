package com.example.facegate.face

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.floor
import kotlin.math.min

/** FP32 SCRFD-10G (640 default) + LVFace-T (112) running entirely on the Android CPU. */
internal class OnnxFaceEngine(modelDirectory: File, private val options: DetectorOptions = DetectorOptions()) : FaceInference {
    private val environment = OrtEnvironment.getEnvironment()
    private val detector: OrtSession
    private val recognizer: OrtSession
    private val detectorInput: String
    private val recognizerInput: String
    val description: String = "SCRFD-10G + LVFace-T · ONNX CPU"

    init {
        val detectorFile = File(modelDirectory, "det_10g.onnx")
        val recognizerFile = File(modelDirectory, "LVFace-T_Glint360K.onnx")
        require(detectorFile.isFile && recognizerFile.isFile) { "Import both detector and LVFace-T ONNX models first" }
        detector = open(detectorFile)
        try {
            recognizer = open(recognizerFile)
        } catch (error: Throwable) {
            detector.close()
            throw error
        }
        try {
            detectorInput = validateInput(detector, options.inputSize)
            recognizerInput = validateInput(recognizer, 112)
            require(detector.outputInfo.size == 9) { "Detector must be SCRFD with nine score/box/5-point outputs" }
            require(recognizer.outputInfo.size == 1) { "LVFace-T must have one embedding output" }
            val output = recognizer.outputInfo.values.first().info as? TensorInfo
                ?: error("LVFace-T output is not a tensor")
            require(output.type == OnnxJavaType.FLOAT && output.shape.last() == 512L) {
                "Expected FP32 512-dimensional LVFace-T output; got $output"
            }
        } catch (error: Throwable) {
            close()
            throw error
        }
    }

    private fun open(file: File): OrtSession = OrtSession.SessionOptions().use { options ->
        options.setIntraOpNumThreads(min(4, Runtime.getRuntime().availableProcessors()))
        options.setInterOpNumThreads(1)
        environment.createSession(file.absolutePath, options)
    }

    private fun validateInput(session: OrtSession, size: Int): String {
        require(session.inputInfo.size == 1) { "Model must have exactly one image input" }
        val input = session.inputInfo.entries.first()
        val info = input.value.info as? TensorInfo ?: error("Image input must be a tensor")
        val shape = info.shape
        require(info.type == OnnxJavaType.FLOAT && shape.size == 4 &&
            (shape[0] == 1L || shape[0] < 0) && shape[1] == 3L &&
            (shape[2] == size.toLong() || shape[2] < 0) && (shape[3] == size.toLong() || shape[3] < 0)) {
            "Expected FP32 [1,3,$size,$size] input; got $info. TensorRT engines and FP16 models are unsupported."
        }
        return input.key
    }

    override fun embed(bitmap: Bitmap, detection: Detection): FloatArray {
        val aligned = align(bitmap, detection.landmarks)
        return try { embedAligned(aligned) } finally { aligned.recycle() }
    }

    override fun detect(bitmap: Bitmap): List<Detection> {
        val size = options.inputSize
        val ratio = min(size.toDouble() / bitmap.width, size.toDouble() / bitmap.height)
        val width = (bitmap.width * ratio).toInt().coerceIn(1, size)
        val height = (bitmap.height * ratio).toInt().coerceIn(1, size)
        // Match source: preserve aspect ratio, pad black at right/bottom, scale by resized height.
        val scale = height.toFloat() / bitmap.height
        val resized = Bitmap.createScaledBitmap(bitmap, width, height, true)
        val padded = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        Canvas(padded).drawBitmap(resized, 0f, 0f, null)
        if (resized !== bitmap) resized.recycle()
        val input = try { nchw(padded, 127.5f, 128f) } finally { padded.recycle() }
        var detections: List<Detection> = emptyList()
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(input), longArrayOf(1, 3, size.toLong(), size.toLong())).use { tensor ->
            detector.run(mapOf(detectorInput to tensor)).use { result ->
                val outputs = (0 until result.size()).map { index ->
                    val value = result[index] as? OnnxTensor ?: error("SCRFD output is not a tensor")
                    val shape = value.info.shape
                    require(value.info.type == OnnxJavaType.FLOAT && shape.size in 2..3) { "Unsupported SCRFD tensor: ${value.info}" }
                    val columns = shape.last().toInt()
                    val buffer = value.floatBuffer
                    val array = FloatArray(buffer.remaining()).also { buffer.get(it) }
                    require(columns in listOf(1, 4, 10) && array.all { it.isFinite() }) { "Invalid SCRFD output" }
                    DetectorOutput(array.size / columns, columns, array)
                }
                detections = ScrfdDecoder.decode(outputs, scale, options)
            }
        }
        return detections.map { detection ->
            val b = detection.box
            detection.copy(box = Box(b.left.coerceIn(0f, bitmap.width - 1f), b.top.coerceIn(0f, bitmap.height - 1f),
                b.right.coerceIn(0f, bitmap.width - 1f), b.bottom.coerceIn(0f, bitmap.height - 1f)))
        }
    }

    private fun embedAligned(bitmap: Bitmap): FloatArray {
        val input = nchw(bitmap, 127.5f, 127.5f)
        OnnxTensor.createTensor(environment, FloatBuffer.wrap(input), longArrayOf(1, 3, 112, 112)).use { tensor ->
            recognizer.run(mapOf(recognizerInput to tensor)).use { result ->
                val output = result[0] as? OnnxTensor ?: error("LVFace-T output is not a tensor")
                val buffer = output.floatBuffer
                require(buffer.remaining() == 512) { "LVFace-T did not produce one 512-D embedding" }
                return FaceMath.normalize(FloatArray(512).also { buffer.get(it) })
            }
        }
    }

    private fun nchw(bitmap: Bitmap, mean: Float, divisor: Float): FloatArray {
        val count = bitmap.width * bitmap.height
        val pixels = IntArray(count)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return FloatArray(count * 3).also { values ->
            for (i in pixels.indices) {
                values[i] = (Color.red(pixels[i]) - mean) / divisor
                values[count + i] = (Color.green(pixels[i]) - mean) / divisor
                values[count * 2 + i] = (Color.blue(pixels[i]) - mean) / divisor
            }
        }
    }

    /** Inverse similarity warp with bilinear RGB sampling and black borders. */
    private fun align(bitmap: Bitmap, points: List<Point>): Bitmap {
        val (a, b, tx, ty) = FaceMath.similarity(points)
        val determinant = a * a + b * b
        val source = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(source, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        fun pixel(x: Int, y: Int): Int = if (x in 0 until bitmap.width && y in 0 until bitmap.height)
            source[y * bitmap.width + x] else Color.BLACK
        val pixels = IntArray(112 * 112)
        for (y in 0 until 112) for (x in 0 until 112) {
            val sx = (a * (x - tx) + b * (y - ty)) / determinant
            val sy = (-b * (x - tx) + a * (y - ty)) / determinant
            val ix = floor(sx).toInt(); val iy = floor(sy).toInt()
            val fx = sx - ix; val fy = sy - iy
            val neighbors = intArrayOf(pixel(ix, iy), pixel(ix + 1, iy), pixel(ix, iy + 1), pixel(ix + 1, iy + 1))
            val weights = doubleArrayOf((1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy)
            fun channel(shift: Int) = neighbors.indices.sumOf { ((neighbors[it] shr shift) and 255) * weights[it] }
                .toInt().coerceIn(0, 255)
            pixels[y * 112 + x] = Color.rgb(channel(16), channel(8), channel(0))
        }
        return Bitmap.createBitmap(pixels, 112, 112, Bitmap.Config.ARGB_8888)
    }

    override fun close() { try { detector.close() } finally { recognizer.close() } }
}
