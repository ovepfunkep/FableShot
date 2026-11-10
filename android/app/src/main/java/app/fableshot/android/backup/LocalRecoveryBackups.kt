package app.fableshot.android.backup

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.zip.ZipFile

data class RecoveryBackup(val file: File, val savedAtMs: Long, val sizeBytes: Long, val manifest: ArchiveManifest)
data class RecoveryBackupIssue(val fileName: String, val reason: String)
data class RecoveryBackupCatalog(val latest: RecoveryBackup?, val issues: List<RecoveryBackupIssue>)

/** Durable pre-reset copies live outside generations and their preferences. No shared-storage scan. */
class LocalRecoveryBackups(
    private val root: File,
    private val checkpoint: (String) -> Unit = {},
) {
    private val namePattern = Regex("([0-9]{13})-([0-9a-f-]{36})\\.fableshot")

    suspend fun save(archive: JournalArchive, exported: ExportedArchive): RecoveryBackup = withContext(Dispatchers.IO) {
        // Full relational/integrity validation must succeed before a reset can publish.
        val prepared = archive.prepare(exported.file)
        try {
            checkpoint("backup_validated")
            currentCoroutineContext().ensureActive()
            if (!root.exists() && !root.mkdirs()) throw IOException("recovery_directory_unavailable")
            require(root.isDirectory) { "recovery_directory_unavailable" }
            DiaryGenerations.syncDirectory(requireNotNull(root.parentFile))
            val savedAt = System.currentTimeMillis()
            val target = File(root, "$savedAt-${UUID.randomUUID()}.fableshot")
            val temporary = File(root, ".${UUID.randomUUID()}.tmp")
            try {
                val coroutine = currentCoroutineContext()
                FileOutputStream(temporary).use { output ->
                    exported.file.inputStream().use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            coroutine.ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                        }
                    }
                    output.fd.sync()
                }
                val manifest = inspect(temporary)
                checkpoint("before_backup_rename")
                coroutine.ensureActive()
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
                DiaryGenerations.syncDirectory(root)
                checkpoint("backup_saved")
                coroutine.ensureActive()
                RecoveryBackup(target, savedAt, target.length(), manifest)
            } finally {
                temporary.delete()
            }
        } finally {
            archive.discard(prepared.directory)
        }
    }

    suspend fun discover(): RecoveryBackupCatalog = withContext(Dispatchers.IO) {
        if (!root.exists()) return@withContext RecoveryBackupCatalog(null, emptyList())
        if (!root.isDirectory) throw IOException("recovery_directory_unavailable")
        val files = root.listFiles() ?: throw IOException("recovery_directory_unreadable")
        val issues = mutableListOf<RecoveryBackupIssue>()
        var latest: RecoveryBackup? = null
        // Names are the durable catalog. An incomplete .tmp file is never offered for restore.
        for (file in files.filter { namePattern.matches(it.name) }.sortedByDescending { it.name }) {
            currentCoroutineContext().ensureActive()
            try {
                validateMember(file)
                val manifest = inspect(file)
                latest = RecoveryBackup(file, file.name.substringBefore('-').toLong(), file.length(), manifest)
                break
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                issues += RecoveryBackupIssue(file.name, (error as? ArchiveInvalid)?.reason ?: "backup_unreadable")
            }
        }
        RecoveryBackupCatalog(latest, issues)
    }

    suspend fun stage(backup: RecoveryBackup, archive: JournalArchive): File = withContext(Dispatchers.IO) {
        validateMember(backup.file)
        archive.stage(backup.file.inputStream())
    }

    private fun validateMember(file: File) {
        require(namePattern.matches(file.name) && file.isFile && file.canonicalFile.parentFile == root.canonicalFile) {
            "invalid_recovery_backup"
        }
    }

    private suspend fun inspect(file: File): ArchiveManifest {
        val coroutine = currentCoroutineContext()
        val check = { coroutine.ensureActive() }
        val limits = ArchiveLimits()
        val manifest = ZipFile(file).use { zip ->
            val entry = zip.getEntry("manifest.json") ?: throw ArchiveInvalid("missing_manifest")
            zip.getInputStream(entry).use { input ->
                val bytes = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    check()
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count > limits.maxManifestBytes - bytes.size()) throw ArchiveInvalid("invalid_manifest_size")
                    bytes.write(buffer, 0, count)
                }
                ArchiveManifestCodec.decode(bytes.toByteArray(), limits)
            }
        }
        file.inputStream().use { ArchiveEnvelopeVerifier.inspect(it, manifest.envelope, limits, check) }
        return manifest
    }
}
