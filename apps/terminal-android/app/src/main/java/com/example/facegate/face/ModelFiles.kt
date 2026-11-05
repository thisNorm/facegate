package com.example.facegate.face

import android.content.Context
import java.io.File
import java.security.MessageDigest

internal object ModelFiles {
    private val names = listOf("det_10g.onnx", "LVFace-T_Glint360K.onnx")

    @Synchronized
    fun install(context: Context): File {
        val directory = File(context.filesDir, "face-models").apply { check(isDirectory || mkdirs()) }
        for (name in names) {
            val target = File(directory, name)
            val expected = context.assets.open("models/$name").use { digest(it) }
            if (target.isFile && target.inputStream().use { digest(it) } == expected) continue
            val temporary = File.createTempFile("model-", ".tmp", directory)
            try {
                context.assets.open("models/$name").use { input -> temporary.outputStream().use { input.copyTo(it) } }
                check(temporary.inputStream().use { digest(it) } == expected) { "Model copy checksum mismatch: $name" }
                check(temporary.renameTo(target)) { "Cannot install model: $name" }
            } finally { temporary.delete() }
        }
        return directory
    }

    private fun digest(input: java.io.InputStream): String {
        val sha = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            sha.update(buffer, 0, count)
        }
        return sha.digest().joinToString("") { "%02x".format(it) }
    }
}
