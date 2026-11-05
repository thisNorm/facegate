package com.example.facegate.face

import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Requires separately supplied models; no network, camera, reference dataset or access decision. */
@RunWith(AndroidJUnit4::class)
class OnnxModelSmokeTest {
    @Test fun suppliedModelsExecuteOnAndroidCpu() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val arguments = InstrumentationRegistry.getArguments()
        val directory = arguments.getString("faceModelDir")?.let(::File) ?: ModelFiles.install(context)
        OnnxFaceEngine(directory).use { engine ->
            val image = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
            try {
                image.eraseColor(Color.GRAY)
                assertTrue(engine.detect(image).isEmpty())
                // Synthetic landmarks exercise alignment/LVFace, not recognition accuracy.
                val vector = engine.embed(image, Detection(Box(0f, 0f, 112f, 112f), 1f, FaceMath.template))
                assertEquals(512, vector.size)
                assertTrue(vector.all { it.isFinite() })
                assertEquals(1f, FaceMath.cosine(vector, vector), 1e-4f)
            } finally { image.recycle() }
        }
    }
}
