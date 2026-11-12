package app.fableshot.android

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Environment
import android.provider.MediaStore
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.export.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID

class TrainingPosterTest {
    @Test fun incompleteSeriesAndRoundUseOnlyEnteredShotsIncludingMissesForDisplayedMaximum() {
        val fixture=reportFixture()
        val first=fixture.blocks.first()
        val partial=first.ends.first().let { entry ->
            entry.copy(end=entry.end.copy(plannedCount=6,state="open"),
                shots=entry.shots.mapIndexed { index,shot ->
                    val points=listOf(10,8,0)[index]
                    shot.copy(points=points,zoneCode=if(points==0)"M"else points.toString())
                })
        }
        val source=fixture.copy(blocks=listOf(first.copy(ends=listOf(partial,first.ends[1]))),plans=emptyList())
        val rows=TrainingPoster.cards(source).flatMap {it.rows}
        assertEquals(6,rows.first().source.end.plannedCount)
        assertEquals(3,rows.first().source.shots.size)
        assertEquals(18,rows.first().source.shots.sumOf {it.points})
        assertEquals(30,rows.first().resultMaximum)
        assertEquals(60,posterResultMaximum(rows))

        val afterRemoval=rows.first().copy(source=partial.copy(shots=partial.shots.dropLast(1)))
        assertEquals(20,afterRemoval.resultMaximum)
        assertEquals(50,posterResultMaximum(listOf(afterRemoval,rows.last())))
        assertEquals(6,partial.end.plannedCount)
        assertEquals(3,partial.shots.size)
    }

    @Test fun posterNeverInventsScoredMaximumForCountOnlyOrUnknownTargets() {
        val fixture=reportFixture()
        val row=TrainingPoster.cards(fixture).first().rows.first()
        val unknown=row.copy(maximumPerArrow=null)
        val counted=row.copy(countOnly=true,source=row.source.copy(shots=emptyList(),
            counts=listOf(JournalCount(row.source.end.id,5,0,0))))
        assertNull(unknown.resultMaximum)
        assertNull(counted.resultMaximum)
        assertNull(posterResultMaximum(listOf(row,unknown)))
        assertNull(posterResultMaximum(listOf(counted)))
        assertNull(posterResultMaximum(emptyList()))
        val empty=row.copy(source=row.source.copy(shots=emptyList()))
        assertEquals(0,empty.resultMaximum)
    }

    @Test fun everyRoundSeriesAndShotIsIncludedAndThemedImageCanBeSharedReadOnly() {
        val source=reportFixture()
        val cards=TrainingPoster.cards(source)
        assertEquals(listOf(1,2),cards.map {it.round})
        assertEquals(20,cards.flatMap {it.rows}.map {it.source.end.id}.distinct().size)
        assertEquals(60,cards.flatMap {it.rows}.sumOf {it.source.shots.size})
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(context.getExternalFilesDir("verification"),"posters").apply {mkdirs()}
        val palettes=listOf(
            "sport" to PosterPalette(0xff101610.toInt(),0xff1a231c.toInt(),0xfff0f5e9.toInt(),0xffb1bcad.toInt(),0xffc6f43d.toInt(),0xff14200d.toInt(),0xff344035.toInt(),0xffffd882.toInt()),
            "light" to PosterPalette(0xfff4f6f1.toInt(),0xffffffff.toInt(),0xff182218.toInt(),0xff586554.toInt(),0xff496411.toInt(),0xffffffff.toInt(),0xffd8dfd4.toInt(),0xff966500.toInt()),
            "pop" to PosterPalette(0xff181023.toInt(),0xff291d39.toInt(),0xfff6edff.toInt(),0xffcdbddd.toInt(),0xffcaabff.toInt(),0xff14200d.toInt(),0xff4b3c5a.toInt(),0xffffd882.toInt()))
        palettes.forEach { (name,palette) ->
            val files=TrainingPoster.create(context,source,"male",palette)
            try {
                assertEquals(1,files.size)
                val bitmap=BitmapFactory.decodeFile(files.single().absolutePath)
                assertEquals(1080,bitmap.width);assertTrue(bitmap.height in 1350..4096)
                assertEquals(palette.background,bitmap.getPixel(0,0));bitmap.recycle()
                files.single().copyTo(File(folder,"poster-$name.png"),overwrite=true)
                val intent=imageShareIntent(context,files)
                assertEquals(Intent.ACTION_SEND,intent.action);assertEquals("image/png",intent.type)
                assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION!=0)
                assertEquals(1,intent.clipData!!.itemCount)
                assertTrue(source.rankAssessment("male").finalResult)
            } finally {files.forEach {it.delete()}}
        }
    }

    @Test fun longRoundSplitsWithoutLosingOrDuplicatingSeriesAndCountOnlyVolumeIsNotInventedPoints() {
        val source=reportFixture()
        val first=source.blocks.first()
        val ends=List(25) {i -> first.ends.first().let {entry -> entry.copy(end=entry.end.copy(id="long-$i",ordinal=i),shots=entry.shots.map {it.copy(id="shot-$i-${it.inputIndex}",endId="long-$i")})}}
        val long=source.copy(blocks=listOf(first.copy(ends=ends)),plans=emptyList())
        val cards=TrainingPoster.cards(long)
        assertEquals(listOf(10,10,5),cards.map {it.rows.size})
        assertEquals((1..25).toList(),cards.flatMap {it.rows}.map {it.number})
        val counted=long.copy(blocks=listOf(first.copy(block=first.block.copy(mode="count_only"),ends=listOf(ends.first().copy(shots=emptyList(),counts=listOf(JournalCount(ends.first().end.id,3,0,0)))))))
        val row=TrainingPoster.cards(counted).single().rows.single()
        assertTrue(row.countOnly);assertEquals(3,row.source.volume);assertTrue(row.source.shots.isEmpty())
    }

    @Test fun allPagesArePublicAndReadableAndShareIntentStillCarriesAllPages() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val resolver=context.contentResolver
        val pages=listOf(pngPage(),pngPage())
        val downloads=mutableListOf<android.net.Uri>()
        try {
            downloads.addAll(savePosterToDownloads(context,pages))
            assertEquals(2,downloads.size)
            for((page,uri) in pages.zip(downloads)) {
                resolver.query(uri,arrayOf(MediaStore.MediaColumns.RELATIVE_PATH,MediaStore.MediaColumns.IS_PENDING),null,null,null)!!.use {row ->
                    assertTrue(row.moveToFirst())
                    assertEquals("${Environment.DIRECTORY_DOWNLOADS}/FableShot/",row.getString(0))
                    assertEquals(0,row.getInt(1))
                }
                assertArrayEquals(page.readBytes(),resolver.openInputStream(uri)!!.use {it.readBytes()})
            }
            val intent=imageShareIntent(context,pages)
            assertEquals(Intent.ACTION_SEND_MULTIPLE,intent.action)
            assertEquals(2,intent.clipData!!.itemCount)
            assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION!=0)
        } finally {
            downloads.forEach {resolver.delete(it,null,null)}
            pages.forEach {it.delete()}
        }
    }

    @Suppress("DEPRECATION")
    @Test fun failedSecondPageRemovesPendingDownloadsFromThatAttempt() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val resolver=context.contentResolver
        val first=pngPage()
        val missing=File(first.parentFile,"verification-poster-${UUID.randomUUID()}.png")
        val downloads=MediaStore.setIncludePending(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY))
        val selection="${MediaStore.MediaColumns.DISPLAY_NAME} IN (?,?)"
        val names=arrayOf(first.name,missing.name)
        try {
            try {
                savePosterToDownloads(context,listOf(first,missing))
                fail("A missing page must fail the download batch")
            } catch(_:FileNotFoundException) { }
            resolver.query(downloads,arrayOf(MediaStore.MediaColumns._ID),selection,names,null)!!.use {row ->
                assertFalse(row.moveToFirst())
            }
        } finally {
            resolver.delete(downloads,selection,names)
            first.delete()
        }
    }

    private fun pngPage():File {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val file=File(File(context.cacheDir,"reports").apply {mkdirs()},"verification-poster-${UUID.randomUUID()}.png")
        val bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888)
        try {file.outputStream().use {assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}}
        finally {bitmap.recycle()}
        return file
    }
}
