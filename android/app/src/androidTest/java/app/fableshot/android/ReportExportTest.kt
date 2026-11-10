package app.fableshot.android
import androidx.test.platform.app.InstrumentationRegistry
import androidx.core.content.FileProvider
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import app.fableshot.android.data.*
import app.fableshot.android.export.AnalyticsPdf
import org.junit.Test
import org.junit.Assert.*
import java.io.File
class ReportExportTest {
 private fun row(id:String,distance:Double)=SessionSummary(id,"Занятие с кириллицей "+id,1,"completed",3,27,distance,600,"practice-full-10-v1",JournalSummaryMeta(1,3,true,false,localDate="2026-10-30",zoneCounts=List(11){if(it==9)3 else 0},positions=listOf(app.fableshot.android.domain.TargetPoint(.1,.1),app.fableshot.android.domain.TargetPoint(.2,.1),app.fableshot.android.domain.TargetPoint(.1,.2))))
 @Test fun groupsStaySeparateAndPdfCanBeReadViaScopedProvider(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val rows=listOf(row("A",18.0),row("B",30.0));assertEquals(2,AnalyticsPdf.groups(rows).size)
  val file=AnalyticsPdf.create(File(context.cacheDir,"reports"),rows,"Выбранные занятия",context.resources.getFont(R.font.manrope_400),context.resources.getFont(R.font.manrope_700))
  try{
   val uri=FileProvider.getUriForFile(context,context.packageName+".reports",file)
   context.contentResolver.openInputStream(uri)!!.use{assertEquals("%PDF-",String(it.readNBytes(5)))}
   PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)).use{pdf->assertTrue(pdf.pageCount>0);pdf.openPage(0).use{page->assertEquals(595,page.width)}}
   file.copyTo(File(context.cacheDir,"reports/verification-report.pdf"),overwrite=true)
   val images=app.fableshot.android.export.ReportImages.create(file,File(context.cacheDir,"reports"));try{assertTrue(images.isNotEmpty());images.first().copyTo(File(context.cacheDir,"reports/verification-report.png"),overwrite=true)}finally{images.forEach{it.delete()}}
  }finally{file.delete()}
 }
 @Test fun emptySelectionIsRejectedAndUndatedRowsAreNotInvented(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  try{AnalyticsPdf.create(context.cacheDir,emptyList(),"Empty");fail()}catch(_:IllegalArgumentException){}
  val a=row("unknown",18.0);assertTrue(AnalyticsPdf.groups(listOf(a.copy(journalMeta=a.journalMeta!!.copy(localDate=null,dateKnown=false)))).isEmpty())
 }
}
