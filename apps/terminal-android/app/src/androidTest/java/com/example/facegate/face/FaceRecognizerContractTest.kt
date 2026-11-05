package com.example.facegate.face

import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FaceRecognizerContractTest {
    private class FakeEngine : FaceInference {
        var calls = 0
        var closed = false
        override fun detect(bitmap: Bitmap): List<Detection> {
            val w = bitmap.width.toFloat(); val h = bitmap.height.toFloat()
            val box = Box(w * .3f, h * .2f, w * .7f, h * .8f)
            return listOf(Detection(box, .99f, FaceMath.template.map {
                Point(box.left + it.x / 112 * (box.right - box.left), box.top + it.y / 112 * (box.bottom - box.top))
            }))
        }
        override fun embed(bitmap: Bitmap, detection: Detection): FloatArray {
            calls++
            return FloatArray(512).also { it[0] = 1f }
        }
        override fun close() { closed = true }
    }

    @Test fun exactApiWaitsBeforeEmbeddingAndGalleryReplacementRemovesIdentities() {
        val backend = FakeEngine()
        var time = 0L
        val recognizer: FaceRecognizer = ScrfdLvFaceRecognizer(backend, FaceRecognitionConfig()) { time }
        val reference = Bitmap.createBitmap(112, 112, Bitmap.Config.ARGB_8888)
        val frame = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
        try {
            recognizer.setGallery(mapOf(15 to listOf(reference)))
            assertEquals(1, backend.calls)
            assertNull(recognizer.recognize(frame)); time += 500
            assertNull(recognizer.recognize(frame)); time += 500
            assertEquals(1, backend.calls) // no live LVFace before stability
            val match = recognizer.recognize(frame)!!
            assertEquals(15, match.employeeKey)
            assertEquals(1f, match.score, 1e-5f)
            assertEquals(192f, match.box.left, 1e-5f)
            recognizer.setGallery(emptyMap())
            assertNull(recognizer.recognize(frame)); time += 500
            assertNull(recognizer.recognize(frame)); time += 500
            val unknown = recognizer.recognize(frame)!!
            assertNull(unknown.employeeKey)
            assertFalse(reference.isRecycled)
            assertFalse(frame.isRecycled)
        } finally { recognizer.close(); reference.recycle(); frame.recycle() }
        recognizer.close()
        assertTrue(backend.closed)
    }
}
