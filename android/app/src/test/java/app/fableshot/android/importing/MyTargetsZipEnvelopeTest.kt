package app.fableshot.android.importing

import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CancellationException
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

class MyTargetsZipEnvelopeTest {
    private val root = Files.createTempDirectory("mytargets-envelope-").toFile()
    @After fun cleanup() { root.deleteRecursively() }

    private fun zip(entries: List<Pair<String, ByteArray>>): File = File.createTempFile("source-", ".zip", root).apply {
        ZipOutputStream(outputStream()).use { zip -> entries.forEach { (name, bytes) ->
            zip.putNextEntry(ZipEntry(name)); zip.write(bytes); zip.closeEntry()
        } }
    }
    private fun rejected(source: File, code: String) {
        try { MyTargetsZipEnvelope.normalize(source, File(root, "normalized.zip"), 2000) {}; fail("Accepted $code") }
        catch (error: ImportRejected) { assertEquals(code, error.code) }
    }

    @Test fun absoluteLegacyNamesBecomeSafeAliasesOnlyInPrivateCopyWithoutChangingPayloadOrSource() {
        val database = "SQLite fixture bytes".toByteArray()
        val image = byteArrayOf(1, 2, 3)
        val source = zip(listOf("/data.db" to database, "/img-fixture.jpg" to image))
        val before = source.readBytes()
        val normalized = File(root, "normalized.zip")
        val names = MyTargetsZipEnvelope.normalize(source, normalized, 2000) {}
        assertArrayEquals(before, source.readBytes())
        ZipFile(normalized).use { zip ->
            for ((alias, original) in names) {
                assertFalse(alias.startsWith("/")); assertFalse(alias.contains(".."))
                assertArrayEquals(if (original == "data.db") database else image, zip.getInputStream(zip.getEntry(alias)).readBytes())
            }
        }
    }

    @Test fun unsafeAndDuplicateOriginalNamesAreRejectedBeforePlatformZipReaders() {
        rejected(zip(listOf("../data.db" to byteArrayOf())), "archive_unsafe_path")
        rejected(zip(listOf("//data.db" to byteArrayOf())), "archive_unsafe_path")
        rejected(zip(listOf("/data.db" to byteArrayOf(), "data.db" to byteArrayOf())), "archive_duplicate_entry")
        rejected(zip(listOf("other.db" to byteArrayOf())), "archive_unsupported_entry")
    }

    @Test fun localCentralNameMismatchAndTruncationAreRejected() {
        val source = zip(listOf("/data.db" to byteArrayOf(1, 2, 3)))
        val bytes = source.readBytes()
        bytes[30] = 'x'.code.toByte()
        source.writeBytes(bytes)
        rejected(source, "archive_corrupt")
        source.writeBytes(bytes.copyOf(20))
        rejected(source, "archive_corrupt")
    }

    @Test fun entryLimitsAndCancellationNeverReturnSuccessfulNormalization() {
        val source = zip(listOf("/data.db" to byteArrayOf(), "img.jpg" to byteArrayOf()))
        try { MyTargetsZipEnvelope.normalize(source, File(root, "normalized.zip"), 1) {}; fail() }
        catch (error: ImportRejected) { assertEquals("archive_too_many_entries", error.code) }
        try { MyTargetsZipEnvelope.normalize(source, File(root, "cancelled.zip"), 2000) { throw CancellationException("fixture") }; fail() }
        catch (_: CancellationException) { }
    }
}
