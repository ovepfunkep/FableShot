package app.fableshot.android.importing

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.StringReader
import java.util.concurrent.CancellationException

class MyTargetsReaderTest {
    private fun fixture()=requireNotNull(javaClass.getResourceAsStream("/mytargets-sample.csv")).readBytes().toString(Charsets.UTF_8)
    private fun header()=MyTargetsReader.HEADERS.joinToString(";"){quote(it)}
    private fun quote(value:String)="\"${value.replace("\"","\"\"")}\""
    private fun row(title:String="Fixture",end:String="1",score:String="10",x:String="0",y:String="0",bow:String="Fixture bow",round:String="1",timestamp:String="10:00:00")=listOf(title,"2026-10-29","Practice","Outdoor",bow,"",round,"10m","WA Full (60cm)",end,timestamp,score,"",x,y).joinToString(";"){quote(it)}
    private suspend fun parse(text:String,grouping:MyTargetsGrouping=MyTargetsGrouping())=MyTargetsReader.read(ByteArrayInputStream(text.toByteArray(Charsets.UTF_8)),grouping)

    @Test fun russianExportHasSameMeaningAndFingerprintAsEnglish()=runBlocking {
        val russian=listOf("Название","Дата","Стандартный раунд","В помещении","Лук","Стрела","Раунд","Дистанция","Мишень","Серия","Временная отметка","Очки","Номера стрел","x","y").joinToString(";"){quote(it)}
        val english=parse(header()+"\n"+row())
        val localized=parse(russian+"\n"+row())
        assertTrue(localized.groups.single().canImport)
        assertEquals(english.groups.single().fingerprint,localized.groups.single().fingerprint)
        assertEquals("Название",localized.headers.first())
    }

    @Test fun suppliedFixtureHasSixEndsEighteenArrowsAndThreeUnknownMissPositions()=runBlocking {
        val arrows=mutableListOf<MyTargetsRow>()
        val preview=MyTargetsReader.read(ByteArrayInputStream(fixture().toByteArray(Charsets.UTF_8)),onRow={arrows.add(it)})
        val group=preview.groups.single()
        assertEquals(18,group.shotCount);assertEquals(6,group.endCount);assertEquals(99,group.points)
        assertEquals(listOf(23,19,18,18,21,0),group.blocks.single().ends.map{it.points})
        assertEquals(10.0,group.blocks.single().conditions.distanceMeters!!,0.0)
        assertEquals(600,group.blocks.single().conditions.diameterMm)
        assertEquals(3,arrows.count{it.zone=="M"&&it.x==null&&it.y==null&&it.positionStatus=="unknown"})
        assertEquals(15,arrows.count{it.positionStatus=="unverified"})
        assertEquals(18,arrows.map{it.record}.distinct().size)
        assertTrue(group.canImport);assertFalse(group.ambiguousBoundary)
        assertEquals(64,preview.fileHash.length)
    }

    @Test fun quotedDelimiterEscapedQuoteMultilineBomAndCrLfArePreserved()=runBlocking {
        val title="Bow; \"story\"\r\nsecond line"
        val text="\uFEFF"+header()+"\r\n"+row(title=title)+"\r\n"
        val group=parse(text).groups.single()
        assertEquals(title,group.title);assertEquals(1,group.shotCount)
        assertEquals(2,group.firstRecord)
        val records=SemicolonCsv.records(StringReader(text)).toList()
        assertEquals(2,records[1].line)
    }

    @Test fun reorderedAndAdditionalColumnsKeepTheSameKnownValues()=runBlocking {
        val records=SemicolonCsv.records(StringReader(header()+"\n"+row())).toList()
        val order=records.first().values.indices.reversed()
        fun encode(values:List<String>)=(listOf("extra")+order.map{values[it]}).joinToString(";"){quote(it)}
        val preview=parse(encode(records[0].values)+"\n"+encode(records[1].values))
        assertEquals(10,preview.groups.single().points);assertEquals("Fixture bow",preview.groups.single().blocks.single().conditions.bow)
        assertTrue("extra" in preview.headers)
    }

    @Test fun fingerprintIgnoresHeaderOrderAndQuotingButNotRealRepeatedArrows()=runBlocking {
        val source=header()+"\n"+row()+"\n"+row()
        val original=parse(source)
        val records=SemicolonCsv.records(StringReader(source)).toList()
        val reversed=records.joinToString("\n"){it.values.reversed().joinToString(";"){cell->quote(cell)}}
        assertEquals(original.groups.single().fingerprint,parse(reversed).groups.single().fingerprint)
        assertNotEquals(original.fileHash,parse(reversed).fileHash)
        assertEquals(2,original.groups.single().shotCount)
        assertNotEquals(parse(header()+"\n"+row()).groups.single().fingerprint,original.groups.single().fingerprint)
    }

    @Test fun changingEquipmentMakesABlockAndResettingEndNumbersSuggestsANewGroup()=runBlocking {
        val blocks=parse(header()+"\n"+row()+"\n"+row(bow="Another fixture bow"))
        assertEquals(1,blocks.groups.size);assertEquals(2,blocks.groups.single().blocks.size)
        val reset=parse(header()+"\n"+row(end="1")+"\n"+row(end="2")+"\n"+row(end="1"))
        assertEquals(2,reset.groups.size);assertTrue(reset.groups.last().ambiguousBoundary)
        val merged=parse(header()+"\n"+row(end="1")+"\n"+row(end="2")+"\n"+row(end="1"),MyTargetsGrouping(joinBeforeRecords=setOf(4)))
        assertEquals(1,merged.groups.size);assertEquals(3,merged.groups.single().shotCount)
    }

    @Test fun explicitSplitAndDifferentSessionsPreserveFileOrder()=runBlocking {
        val text=header()+"\n"+row()+"\n"+row()+"\n"+row(title="Second fixture")
        val normal=parse(text);assertEquals(listOf(2,1),normal.groups.map{it.shotCount})
        val split=parse(text,MyTargetsGrouping(splitBeforeRecords=setOf(3)))
        assertEquals(listOf(1,1,1),split.groups.map{it.shotCount})
    }

    @Test fun invalidScoreBlocksItsGroupWhileInvalidCoordinatesRemainUnknown()=runBlocking {
        val rows=mutableListOf<MyTargetsRow>()
        val text=header()+"\n"+row(score="?")+"\n"+row(x="NaN",y="0.2")
        val preview=MyTargetsReader.read(ByteArrayInputStream(text.toByteArray()),onRow={rows.add(it)})
        assertFalse(preview.groups.single().canImport)
        assertTrue(preview.groups.single().issues.any{it.code=="unsupported_score"&&it.line==2})
        assertTrue(preview.groups.single().issues.any{it.code=="invalid_coordinate_pair"})
        assertNull(rows.last().x);assertNull(rows.last().y)
        assertEquals(2,preview.groups.single().shotCount)
    }

    @Test fun actualCentreAndXAreNeverConvertedIntoMissingOrRecomputed()=runBlocking {
        val rows=mutableListOf<MyTargetsRow>()
        MyTargetsReader.read(ByteArrayInputStream((header()+"\n"+row(score="X")+"\n"+row(score="9",x="0",y="0")).toByteArray()),onRow={rows.add(it)})
        assertEquals(listOf(10,9),rows.map{it.points});assertEquals("X",rows.first().zone)
        assertEquals(0.0,rows.first().x!!,0.0);assertTrue(rows.all{it.positionStatus=="unverified"})
    }

    @Test fun malformedCsvUnsupportedHeadersAndInvalidUtf8FailClearly()=runBlocking {
        for(text in listOf("\"unclosed", "a;b\n1;2",header()+"\n\"closed\"bad")) {
            try{parse(text);fail("Invalid source accepted")}catch(_:IllegalArgumentException){}
        }
        try{MyTargetsReader.read(ByteArrayInputStream(byteArrayOf(0xC3.toByte(),0x28)));fail("Invalid UTF-8 accepted")}catch(_:java.nio.charset.CharacterCodingException){}
    }

    @Test fun rowColumnFieldLimitsAndCancellationDoNotReturnPartialSuccess()=runBlocking {
        for(block in listOf<()->Unit>(
            {SemicolonCsv.records(StringReader("a;b;c"),maxColumns=2).toList()},
            {SemicolonCsv.records(StringReader("abcd"),maxFieldChars=3).toList()},
            {SemicolonCsv.records(StringReader("a\nb\nc"),maxRecords=2).toList()},
        )){try{block();fail("Limit ignored")}catch(_:CsvFormatException){}}
        var checked=0
        try{MyTargetsReader.read(ByteArrayInputStream((header()+"\n"+row()).toByteArray()),checkCancelled={if(++checked>=2)throw CancellationException("fixture cancel")});fail("Cancelled parse returned success")}catch(_:CancellationException){}
    }
}
