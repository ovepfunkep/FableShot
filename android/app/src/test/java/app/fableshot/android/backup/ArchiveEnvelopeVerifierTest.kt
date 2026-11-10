package app.fableshot.android.backup

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.CancellationException
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ArchiveEnvelopeVerifierTest {
    private val data=ArchiveEnvelopeVerifier.requiredPaths.associateWith{if(it.endsWith("jsonl"))"{}\n".toByteArray()else"{}".toByteArray()}
    private val specs=data.map{(name,bytes)->ArchivePayload(name,bytes.size.toLong(),ArchiveEnvelopeVerifier.sha256(bytes))}
    private val manifest=("{\"formatVersion\":1,\"journalSchema\":3,\"equipmentSchema\":1,\"entries\":["+specs.joinToString{p->"{\"path\":\"${p.path}\",\"bytes\":${p.bytes},\"sha256\":\"${p.sha256}\"}"}+"]}").toByteArray()
    private val envelope=ArchiveEnvelope(manifest,11,13,1,specs)
    private fun zip(payload:Map<String,ByteArray> = data,manifestBytes:ByteArray=manifest)=ByteArrayOutputStream().also{out->ZipOutputStream(out).use{zip->for((name,bytes)in payload+mapOf("manifest.json" to manifestBytes)){zip.putNextEntry(ZipEntry(name));zip.write(bytes);zip.closeEntry()}}}.toByteArray()
    private fun rejected(action:()->Unit){try{action();fail("Invalid envelope accepted")}catch(_:ArchiveInvalid){}}
    @Test fun intactEnvelopeVerifiesWithoutExtractingOrTrustingJsonFacts() {
        val result=ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip(data.toSortedMap(reverseOrder()))),envelope)
        assertEquals(data.size+1,result.entries);assertEquals(manifest.size+data.values.sumOf{it.size}.toLong(),result.verifiedBytes)
    }
    @Test fun previousArchiveSchemasRemainSupportedWithTheirOriginalTables() {
        for(schema in 3..16) {
            val payloads=ArchiveEnvelopeVerifier.requiredPathsFor(schema).map {ArchivePayload(it,0,ArchiveEnvelopeVerifier.sha256(byteArrayOf()))}
            ArchiveEnvelopeVerifier.validate(envelope.copy(formatVersion=schema-2,journalSchema=schema,payloads=payloads))
        }
    }
    @Test fun achievementPayloadsAreRequiredInFormatEightAndForbiddenInFormatSeven() {
        val paths=listOf("data/journal/achievement_enrollments.jsonl","data/journal/achievement_grants.jsonl")
        val eight=specs.filter {it.path in ArchiveEnvelopeVerifier.requiredPathsFor(10)}
        for(path in paths)rejected {
            ArchiveEnvelopeVerifier.validate(envelope.copy(formatVersion=8,journalSchema=10,payloads=eight.filterNot {it.path==path}))
        }
        val legacy=specs.filter {it.path in ArchiveEnvelopeVerifier.requiredPathsFor(9)}
        for(path in paths)rejected {
            ArchiveEnvelopeVerifier.validate(envelope.copy(formatVersion=7,journalSchema=9,
                payloads=legacy+specs.single {it.path==path}))
        }
    }
    @Test fun recordEventsAreRequiredInFormatTenAndForbiddenInFormatNine() {
        val priorPayloads=specs.filterNot {it.path=="data/journal/personal_record_events.jsonl"}
        assertEquals(specs.size-1,priorPayloads.size)
        rejected {ArchiveEnvelopeVerifier.validate(envelope.copy(payloads=priorPayloads))}
        rejected {ArchiveEnvelopeVerifier.validate(envelope.copy(formatVersion=9,journalSchema=11))}
        ArchiveEnvelopeVerifier.validate(envelope.copy(formatVersion=9,journalSchema=11,payloads=priorPayloads))
    }
    @Test fun traversalAbsoluteBackslashAndUnexpectedFilesAreRejected() {
        for(name in listOf("../outside","/absolute","C:/outside","sources\\outside","data/journal/../shots.jsonl","unknown.txt"))rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip(data+mapOf(name to byteArrayOf(1)))),envelope)}
    }
    @Test fun alteredPayloadAndAlteredManifestNeverPassTheirOriginalChecksums() {
        val key=data.keys.first()
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip(data+mapOf(key to byteArrayOf(1,2,3)))),envelope)}
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip(manifestBytes=manifest+byteArrayOf(32))),envelope)}
    }
    @Test fun missingTablesEntriesAndDuplicateMetadataAreRejected() {
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip(data-data.keys.first())),envelope)}
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope.copy(payloads=specs.drop(1)))}
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope.copy(payloads=specs+specs.first()))}
    }
    @Test fun versionsSizesCountsAndNegativeMetadataAreBoundedBeforeExtraction() {
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope.copy(formatVersion=99))}
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope,ArchiveLimits(maxUncompressedBytes=1))}
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope,ArchiveLimits(maxEntries=1))}
        rejected{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope.copy(payloads=specs.mapIndexed{i,p->if(i==0)p.copy(bytes=-1)else p}))}
    }
    @Test fun cancellationNeverReturnsASuccessfulInspection() {
        var calls=0
        try{ArchiveEnvelopeVerifier.inspect(ByteArrayInputStream(zip()),envelope,checkCancelled={if(++calls==3)throw CancellationException("fixture cancellation")});fail("Cancellation ignored")}catch(_:CancellationException){}
    }
}
