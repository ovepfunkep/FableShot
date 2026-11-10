package app.fableshot.android.backup

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

data class ArchiveManifest(
    val createdAtMs:Long,
    val appVersion:String,
    val rowCounts:Map<String,Long>,
    val envelope:ArchiveEnvelope,
)

object ArchiveManifestCodec {
    val tablePaths = ArchiveEnvelopeVerifier.requiredPaths.filter{it.endsWith(".jsonl")}.toSet()
    fun encode(createdAtMs:Long,appVersion:String,rowCounts:Map<String,Long>,payloads:List<ArchivePayload>):ByteArray {
        val bytes=ArchiveJson.encode(linkedMapOf(
            "formatVersion" to ArchiveEnvelopeVerifier.CURRENT_FORMAT,"journalSchema" to ArchiveEnvelopeVerifier.CURRENT_JOURNAL_SCHEMA,
            "equipmentSchema" to 1,"preferencesFormat" to 1,
            "createdAtMs" to createdAtMs,"appVersion" to appVersion,"rowCounts" to rowCounts,
            "payloads" to payloads.map{linkedMapOf("path" to it.path,"bytes" to it.bytes,"sha256" to it.sha256)}
        )).toByteArray(Charsets.UTF_8)
        decode(bytes) // Do not emit a manifest we would refuse to read.
        return bytes
    }
    fun decode(bytes:ByteArray,limits:ArchiveLimits=ArchiveLimits()):ArchiveManifest {
        if(bytes.isEmpty()||bytes.size>limits.maxManifestBytes)throw ArchiveInvalid("invalid_manifest_size")
        val root=ArchiveJson.parse(utf8(bytes)).jsonObject()
        root.exactKeys(setOf("formatVersion","journalSchema","equipmentSchema","preferencesFormat","createdAtMs","appVersion","rowCounts","payloads"))
        val format=root.long("formatVersion").toInt();val schema=root.long("journalSchema").toInt()
        if(root.long("formatVersion")!=format.toLong()||root.long("journalSchema")!=schema.toLong()||!ArchiveEnvelopeVerifier.supportsVersion(format,schema)||root.long("equipmentSchema")!=1L||root.long("preferencesFormat")!=1L)throw ArchiveInvalid("unsupported_archive_version")
        val version=root.string("appVersion");if(version.length !in 1..100)throw ArchiveInvalid("invalid_app_version")
        val counts=root["rowCounts"].jsonObject();counts.exactKeys(ArchiveEnvelopeVerifier.requiredPathsFor(schema).filter{it.endsWith(".jsonl")}.toSet())
        val typedCounts=counts.mapValues{(_,v)->(v as? Long)?.takeIf{it>=0}?:throw ArchiveInvalid("invalid_row_count")}
        val list=root["payloads"] as? List<*> ?: throw ArchiveInvalid("invalid_payload_metadata")
        if(list.size+1>limits.maxEntries)throw ArchiveInvalid("too_many_entries")
        val payloads=list.map { raw->val p=raw.jsonObject();p.exactKeys(setOf("path","bytes","sha256"));ArchivePayload(p.string("path"),p.long("bytes"),p.string("sha256")) }
        val envelope=ArchiveEnvelope(bytes.copyOf(),format,schema,1,payloads)
        ArchiveEnvelopeVerifier.validate(envelope,limits)
        return ArchiveManifest(root.long("createdAtMs"),version,typedCounts,envelope)
    }
    internal fun utf8(bytes:ByteArray):String = try {
        Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
    } catch(e:java.nio.charset.CharacterCodingException){throw ArchiveInvalid("invalid_utf8")}
}
