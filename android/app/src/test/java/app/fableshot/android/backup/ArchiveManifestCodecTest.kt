package app.fableshot.android.backup

import org.junit.Assert.*
import org.junit.Test

class ArchiveManifestCodecTest {
    private val payloads=ArchiveEnvelopeVerifier.requiredPaths.map{ArchivePayload(it,0,ArchiveEnvelopeVerifier.sha256(byteArrayOf()))}
    private val counts=ArchiveManifestCodec.tablePaths.associateWith{0L}
    private fun manifest()=ArchiveManifestCodec.encode(9007199254740993L,"0.4.1-dev",counts,payloads)
    private fun reject(text:String){try{ArchiveManifestCodec.decode(text.toByteArray());fail("Invalid manifest accepted")}catch(_:ArchiveInvalid){}}
    @Test fun manifestRoundTripRetainsExactLongAndRequiredFiles() {
        val decoded=ArchiveManifestCodec.decode(manifest());assertEquals(9007199254740993L,decoded.createdAtMs);assertEquals(counts,decoded.rowCounts);assertEquals(payloads,decoded.envelope.payloads)
    }
    @Test fun duplicateFieldsFractionalIntegersAndFutureVersionsAreRefused() {
        val text=manifest().toString(Charsets.UTF_8)
        val field="\"formatVersion\":${ArchiveManifestCodec.decode(manifest()).envelope.formatVersion}"
        reject(text.replace(field,"$field,$field"))
        reject(text.replace(field,"$field.0"))
        reject(text.replace(field,"\"formatVersion\":99"))
        reject(text.dropLast(1)+",\"surprise\":true}")
        reject(text+"{}")
    }
    @Test fun dangerousPathsMissingCountsAndMalformedUtf8AreRefused() {
        reject(manifest().toString(Charsets.UTF_8).replace("data/journal/sessions.jsonl","../sessions.jsonl"))
        reject(manifest().toString(Charsets.UTF_8).replace("\"rowCounts\":{","\"rowCounts\":{\"unknown\":0,"))
        try{ArchiveManifestCodec.decode(byteArrayOf(0xc3.toByte(),0x28));fail()}catch(_:ArchiveInvalid){}
    }
    @Test fun strictJsonRejectsMalformedAndExcessiveNestingWithoutCoercion() {
        for(text in listOf("01","+1","1.","1e400","9223372036854775808","{a:1}","{\"a\":1,}","[1,]","\"\\uD800\"","[".repeat(50)+"]".repeat(50))) {
            try{ArchiveJson.parse(text);fail("Accepted $text")}catch(_:ArchiveInvalid){}
        }
        val text="Мишень 🎯\n\"тест\"\\";assertEquals(text,ArchiveJson.parse(ArchiveJson.encode(text)))
    }
    @Test fun preferencesKeepHiddenDispositionAndExactTypes() {
        val source=mapOf("onboardingDisposition" to ("string" to "skipped"),"onboardingCompletedVersion" to ("int" to 1),"precise" to ("long" to Long.MAX_VALUE),"futureSet" to ("stringSet" to listOf("а","б")),"hapticsEnabled" to ("boolean" to true))
        val decoded=ArchivePreferences.decode(ArchivePreferences.encode(source))
        assertEquals("skipped",decoded.getValue("onboardingDisposition").second);assertEquals(Long.MAX_VALUE,decoded.getValue("precise").second);assertEquals("int",decoded.getValue("onboardingCompletedVersion").first)
    }
    @Test fun knownPreferencesCannotChangeTypesOrContainInvalidEnumValues() {
        for(json in listOf("{\"format\":1,\"values\":{\"animationsEnabled\":{\"type\":\"int\",\"value\":1}}}","{\"format\":1,\"values\":{\"designStyle\":{\"type\":\"string\",\"value\":\"future\"}}}","{\"format\":1,\"values\":{\"set\":{\"type\":\"stringSet\",\"value\":[\"a\",\"a\"]}}}")) {
            try{ArchivePreferences.decode(json.toByteArray());fail()}catch(_:ArchiveInvalid){}
        }
    }
}
