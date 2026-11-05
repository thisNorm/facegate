package com.example.facegate.face

import android.graphics.Bitmap
import android.graphics.RectF
import java.io.Closeable

/** Identity result for the one qualified person standing in front of the terminal. */
data class FaceResult(val employeeKey: Int?, val score: Float, val box: RectF)

interface FaceRecognizer : Closeable {
    /** Explicit reference photos only. Replaces all previous identities, including deletions. */
    fun setGallery(faces: Map<Int, List<Bitmap>>)

    /** Worker-thread call. Null means no qualified, sufficiently stable face. */
    fun recognize(frame: Bitmap): FaceResult?
}
