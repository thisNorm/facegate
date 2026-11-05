package com.example.facegate.face

import org.junit.Assert.*
import org.junit.Test

class RecognitionPolicyTest {
    private fun face(box: Box = Box(350f, 200f, 650f, 650f)): Detection = Detection(box, .95f,
        FaceMath.template.map { Point(box.left + it.x / 112 * (box.right - box.left), box.top + it.y / 112 * (box.bottom - box.top)) })

    @Test fun waitsForThreeFramesAndChoosesLargestEligiblePerson() {
        val policy = RecognitionPolicy(FaceRecognitionConfig())
        val largest = face()
        val smaller = face(Box(400f, 300f, 600f, 550f))
        val faces = listOf(smaller, largest)
        assertNull(policy.select(faces, 1000, 800, 0))
        assertNull(policy.select(faces, 1000, 800, 500))
        assertEquals(largest, policy.select(faces, 1000, 800, 1000))
    }

    @Test fun rejectsSmallOffCenterAndNonFrontalFaces() {
        val normal = face()
        val invalid = listOf(face(Box(450f, 350f, 550f, 450f)), face(Box(0f, 200f, 250f, 650f)),
            normal.copy(landmarks = normal.landmarks.mapIndexed { i, p -> if (i == 2) Point(950f, 500f) else p }))
        for (detection in invalid) {
            val policy = RecognitionPolicy(FaceRecognitionConfig())
            repeat(5) { assertNull(policy.select(listOf(detection), 1000, 800, it * 500L)) }
        }
    }

    @Test fun resetsOnAbsenceGapResizeAndTrackChange() {
        val policy = RecognitionPolicy(FaceRecognitionConfig())
        val faces = listOf(face())
        policy.select(faces, 1000, 800, 0); policy.select(faces, 1000, 800, 500)
        assertNull(policy.select(emptyList(), 1000, 800, 1000))
        assertNull(policy.select(faces, 1000, 800, 1500))
        assertNull(policy.select(faces, 1000, 800, 3501))
        assertNull(policy.select(faces, 1100, 800, 4000))
        val shifted = listOf(face(Box(300f, 100f, 500f, 350f)))
        assertNull(policy.select(shifted, 1100, 800, 4500))
        assertNull(policy.select(shifted, 1100, 800, 5000))
        assertNotNull(policy.select(shifted, 1100, 800, 5500))
    }

    @Test fun twoFramesCanBeConfiguredAndClockReversalResets() {
        val policy = RecognitionPolicy(FaceRecognitionConfig(stableFrames = 2))
        val faces = listOf(face())
        assertNull(policy.select(faces, 1000, 800, 1000))
        assertNull(policy.select(faces, 1000, 800, 500))
        assertNotNull(policy.select(faces, 1000, 800, 1000))
        policy.reset()
        assertNull(policy.select(faces, 1000, 800, 1500))
    }

    @Test fun rejectsTiltAndAsymmetricNoseEvenInsideFacePolygon() {
        val policy = RecognitionPolicy(FaceRecognitionConfig())
        assertTrue(policy.frontal(FaceMath.template))
        val tilted = FaceMath.template.map { Point(it.x - it.y, it.x + it.y) }
        assertFalse(policy.frontal(tilted))
        val turned = FaceMath.template.mapIndexed { i, p -> if (i == 2) Point(43f, p.y) else p }
        assertFalse(policy.frontal(turned))
    }

    @Test fun unknownIdentityRetainsBestScoreButNeverInventsEmployee() {
        val gallery = mapOf(15 to listOf(floatArrayOf(1f, 0f)))
        assertEquals(IdentityMatch(15, 1f), GalleryMatcher.match(floatArrayOf(2f, 0f), gallery, .4f))
        assertEquals(IdentityMatch(null, 0f), GalleryMatcher.match(floatArrayOf(0f, 1f), gallery, .4f))
        assertEquals(IdentityMatch(null, 0f), GalleryMatcher.match(floatArrayOf(1f, 0f), emptyMap(), -1f))
    }

    @Test fun referenceMatchingUsesClosestPhotoAcrossEmployees() {
        val gallery = mapOf(15 to listOf(floatArrayOf(0f, 1f), floatArrayOf(1f, 0f)), 20 to listOf(floatArrayOf(-1f, 0f)))
        assertEquals(15, GalleryMatcher.match(floatArrayOf(1f, 0f), gallery, 1f).employeeKey)
        assertEquals(20, GalleryMatcher.match(floatArrayOf(-1f, 0f), gallery, .4f).employeeKey)
    }

    @Test fun alignmentAndDecoderRejectMalformedInput() {
        assertArrayEquals(doubleArrayOf(1.0, 0.0, 0.0, 0.0), FaceMath.similarity(FaceMath.template), 1e-5)
        assertTrue(runCatching { FaceMath.normalize(floatArrayOf(Float.NaN)) }.isFailure)
        assertTrue(runCatching { ScrfdDecoder.decode(emptyList(), 1f, DetectorOptions()) }.isFailure)
        assertTrue(runCatching { FaceRecognitionConfig(stableFrames = 1) }.isFailure)
    }
}
