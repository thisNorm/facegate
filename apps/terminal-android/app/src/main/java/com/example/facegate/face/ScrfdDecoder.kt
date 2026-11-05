package com.example.facegate.face

internal data class DetectorOutput(val rows: Int, val width: Int, val values: FloatArray)

internal object ScrfdDecoder {
    /** Identify score/box/keypoint tensors by shape, independent of exported output names/order. */
    fun decode(outputs: List<DetectorOutput>, scale: Float, settings: DetectorOptions): List<Detection> {
        require(scale.isFinite() && scale > 0)
        require(outputs.size == 9)
        outputs.forEach { output ->
            require(output.rows > 0 && output.width in listOf(1, 4, 10) &&
                output.values.size == output.rows * output.width && output.values.all { it.isFinite() }) {
                "Invalid SCRFD output"
            }
        }
        val candidates = mutableListOf<Detection>()
        for (stride in listOf(8, 16, 32)) {
            val cells = (settings.inputSize / stride) * (settings.inputSize / stride)
            val scores = outputs.singleOrNull { it.width == 1 && it.rows == cells * 2 }
                ?: error("Expected two-anchor SCRFD-10G score output for stride $stride")
            val boxes = outputs.single { it.width == 4 && it.rows == scores.rows }.values
            val landmarks = outputs.single { it.width == 10 && it.rows == scores.rows }.values
            for (index in scores.values.indices) {
                val score = scores.values[index]
                if (score < settings.detectionThreshold) continue
                val cell = index / 2
                val x = (cell % (settings.inputSize / stride) * stride).toFloat()
                val y = (cell / (settings.inputSize / stride) * stride).toFloat()
                val offset = index * 4
                val box = Box((x - boxes[offset] * stride) / scale,
                    (y - boxes[offset + 1] * stride) / scale,
                    (x + boxes[offset + 2] * stride) / scale,
                    (y + boxes[offset + 3] * stride) / scale)
                if (box.right <= box.left || box.bottom <= box.top) continue
                val points = (0 until 5).map { k -> Point(
                    (x + landmarks[index * 10 + k * 2] * stride) / scale,
                    (y + landmarks[index * 10 + k * 2 + 1] * stride) / scale) }
                candidates += Detection(box, score, points)
            }
        }
        return FaceMath.nms(candidates, settings.nmsThreshold)
    }
}
