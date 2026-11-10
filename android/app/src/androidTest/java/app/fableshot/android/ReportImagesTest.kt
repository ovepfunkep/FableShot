package app.fableshot.android
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.BitmapFactory
import app.fableshot.android.export.ReportImages
import android.graphics.pdf.PdfDocument
import org.junit.Test
import org.junit.Assert.*
import java.io.File
class ReportImagesTest {
 @Test fun everyPdfPageBecomesReadableImage(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val dir=File(context.cacheDir,"verification-images-${java.util.UUID.randomUUID()}").apply{mkdirs()};val source=File(dir,"source.pdf")
  val pdf=PdfDocument();repeat(2){val page=pdf.startPage(PdfDocument.PageInfo.Builder(595,842,it+1).create());page.canvas.drawColor(android.graphics.Color.WHITE);pdf.finishPage(page)};source.outputStream().use{pdf.writeTo(it)};pdf.close()
  try{val images=ReportImages.create(source,dir);assertEquals(2,images.size);images.forEach{val bmp=BitmapFactory.decodeFile(it.path);assertEquals(1190,bmp.width);assertEquals(1684,bmp.height);bmp.recycle()};assertTrue(source.exists())}finally{dir.listFiles()!!.forEach{it.delete()};dir.delete()}
 }
 @Test fun cancellationRemovesPartialImages(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val dir=File(context.cacheDir,"verification-cancel-${java.util.UUID.randomUUID()}").apply{mkdirs()};val source=File(dir,"source.pdf");val pdf=PdfDocument();repeat(2){val page=pdf.startPage(PdfDocument.PageInfo.Builder(50,50,it+1).create());pdf.finishPage(page)};source.outputStream().use{pdf.writeTo(it)};pdf.close();var checks=0
  try{try{ReportImages.create(source,dir){if(++checks==2)throw java.util.concurrent.CancellationException()};fail()}catch(_:java.util.concurrent.CancellationException){};assertEquals(listOf("source.pdf"),dir.listFiles()!!.map{it.name})}finally{source.delete();dir.delete()}
 }
}
