package app.fableshot.android.backup

import java.io.InputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.zip.ZipInputStream

data class ArchivePayload(val path:String,val bytes:Long,val sha256:String)
/** The decoder must validate the manifest JSON and supply its original bounded bytes. */
data class ArchiveEnvelope(val manifestBytes:ByteArray,val formatVersion:Int,val journalSchema:Int,val equipmentSchema:Int,val payloads:List<ArchivePayload>)
data class ArchiveLimits(val maxUncompressedBytes:Long=1024L*1024*1024,val maxEntries:Int=20_000,val maxManifestBytes:Int=8*1024*1024)
data class ArchiveInspection(val entries:Int,val verifiedBytes:Long)
class ArchiveInvalid(val reason:String):IllegalArgumentException(reason)

/** Integrity/path envelope only. JSON facts and relational validity require temporary restoration. */
object ArchiveEnvelopeVerifier {
    const val CURRENT_FORMAT=14
    const val CURRENT_JOURNAL_SCHEMA=16
    internal fun supportsVersion(format:Int,schema:Int)=format in 1..CURRENT_FORMAT&&schema==format+2

    val journalTables=listOf("sessions","blocks","ends","shots","unscored_counts","mutation_receipts","import_batches","imported_groups","imported_rows","imported_end_sources","progress_baselines","session_plans","technique_documents","technique_versions","technique_uses","rank_assignments","diary_notes","achievement_enrollments","achievement_grants","personal_record_events")
    fun journalTablesFor(schema:Int)=journalTables.take(when(schema){3->10;4->11;5->12;6,7->15;8->16;9->17;10,11->19;else->journalTables.size})
    fun requiredPathsFor(schema:Int)=(journalTablesFor(schema).map{"data/journal/$it.jsonl"}+equipmentTables.map{"data/equipment/$it.jsonl"}+"data/preferences.json").toSet()
    val equipmentTables=listOf("equipment_items","equipment_revisions")
    val requiredPaths=(journalTables.map{"data/journal/$it.jsonl"}+equipmentTables.map{"data/equipment/$it.jsonl"}+"data/preferences.json").toSet()
    private val source=Regex("sources/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.csv\\.gz")
    private val checksum=Regex("[0-9a-f]{64}")
    private fun invalid(reason:String):Nothing=throw ArchiveInvalid(reason)
    private fun safe(path:String):Boolean=path.length in 1..240&&path.none{it=='\\'||it==':'||it.code<32}&&path.split('/').none{it.isEmpty()||it=="."||it==".."}&&(path=="manifest.json"||path in requiredPaths||source.matches(path))
    fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
    fun validate(envelope:ArchiveEnvelope,limits:ArchiveLimits=ArchiveLimits()) {
        if(!supportsVersion(envelope.formatVersion,envelope.journalSchema)||envelope.equipmentSchema!=1)invalid("unsupported_archive_version")
        if(envelope.manifestBytes.size>limits.maxManifestBytes||envelope.manifestBytes.isEmpty())invalid("invalid_manifest_size")
        if(envelope.payloads.size+1>limits.maxEntries)invalid("too_many_entries")
        val expected=linkedMapOf("manifest.json" to ArchivePayload("manifest.json",envelope.manifestBytes.size.toLong(),sha256(envelope.manifestBytes)))
        val names=mutableSetOf("manifest.json")
        var declared=envelope.manifestBytes.size.toLong()
        for(payload in envelope.payloads) {
            if(!safe(payload.path)||payload.path=="manifest.json")invalid("unsafe_archive_path")
            if(!names.add(payload.path.lowercase(Locale.ROOT)))invalid("duplicate_archive_path")
            if(payload.bytes<0||!checksum.matches(payload.sha256))invalid("invalid_payload_metadata")
            if(payload.bytes>limits.maxUncompressedBytes-declared)invalid("archive_too_large")
            declared+=payload.bytes;expected[payload.path]=payload
        }
        if(!expected.keys.containsAll(requiredPathsFor(envelope.journalSchema)))invalid("missing_required_payload")
        if(envelope.payloads.any{it.path.startsWith("data/")&&it.path !in requiredPathsFor(envelope.journalSchema)})invalid("unexpected_payload")
    }
    fun inspect(input:InputStream,envelope:ArchiveEnvelope,limits:ArchiveLimits=ArchiveLimits(),checkCancelled:()->Unit={}):ArchiveInspection {
        validate(envelope,limits)
        val expected=(listOf(ArchivePayload("manifest.json",envelope.manifestBytes.size.toLong(),sha256(envelope.manifestBytes)))+envelope.payloads).associateBy{it.path}
        val found=mutableSetOf<String>();val folded=mutableSetOf<String>();var total=0L
        ZipInputStream(input).use { zip->
            val buffer=ByteArray(8192)
            while(true) {
                checkCancelled();val entry=zip.nextEntry?:break
                if(entry.isDirectory||!safe(entry.name))invalid("unsafe_archive_path")
                if(!folded.add(entry.name.lowercase(Locale.ROOT)))invalid("duplicate_archive_path")
                val record=expected[entry.name]?:invalid("unexpected_payload")
                if(found.size>=limits.maxEntries)invalid("too_many_entries")
                if(entry.size>=0&&entry.size!=record.bytes)invalid("payload_size_mismatch")
                val digest=MessageDigest.getInstance("SHA-256");var count=0L
                while(true) {
                    checkCancelled();val n=zip.read(buffer);if(n<0)break
                    if(n.toLong()>record.bytes-count||n.toLong()>limits.maxUncompressedBytes-total)invalid("archive_too_large")
                    count+=n;total+=n;digest.update(buffer,0,n)
                }
                if(count!=record.bytes)invalid("payload_size_mismatch")
                val hash=digest.digest().joinToString(""){"%02x".format(it)}
                if(hash!=record.sha256)invalid("payload_checksum_mismatch")
                found.add(entry.name);zip.closeEntry()
            }
        }
        if(found!=expected.keys)invalid("missing_payload")
        return ArchiveInspection(found.size,total)
    }
}
