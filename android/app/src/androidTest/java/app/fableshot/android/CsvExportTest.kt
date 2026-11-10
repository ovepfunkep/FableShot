package app.fableshot.android
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.export.AnalyticsCsv
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import java.io.StringWriter
class CsvExportTest {
 @Test fun textIsQuotedAndFormulaLikeTextIsEscapedWhileCoordinatesRemainNumeric(){
  assertEquals("\"'  =1+1\"",AnalyticsCsv.cell("  =1+1"))
  assertEquals("\"a;\"\"b\"\"\r\nc\"",AnalyticsCsv.cell("a;\"b\"\r\nc"))
  assertEquals("\"-0.25\"",AnalyticsCsv.cell(-.25));assertEquals("\"\"",AnalyticsCsv.cell(null))
 }
 @Test fun actualJournalKeepsMissXWarmupCounterAndStableIds()=runBlocking(Dispatchers.IO){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val db=Room.inMemoryDatabaseBuilder(context,JournalDatabase::class.java).build();val repo=JournalRepository(db)
  try {
   repo.start("=Занятие; \"Тест\"",BlockPlan(18.0,800,targetProfileId="wa-outdoor-full-v1"))
   var d=repo.active.first()!!;var e=d.currentEnd!!.end
   repo.numericX(e.id);repo.numeric(e.id,0);repo.point(e.id,TargetPoint(-.25,.1))
   d=repo.active.first()!!;repo.startBlock(d.session.id,BlockPlan(null,null,3,"count_only"),d.session.revision)
   d=repo.active.first()!!;e=d.currentEnd!!.end;repo.role(e.id,"warmup",e.revision);e=repo.active.first()!!.currentEnd!!.end;repo.setCount(e.id,2,e.revision)
   d=repo.active.first()!!;repo.complete(d.session.id,d.session.revision)
   val saved=repo.details(d.session.id)!!;val csv=AnalyticsCsv.create(File(context.cacheDir,"reports"),listOf(saved))
   try{val text=csv.readText(Charsets.UTF_8);assertTrue(text.startsWith("\uFEFF"));assertTrue(text.contains("\"X\""));assertTrue(text.contains("\"M\""));assertTrue(text.contains("\"warmup\""));assertTrue(text.contains("\"count\""));assertTrue(text.contains("\"-0.25\""));saved.allShots.forEach{assertTrue(text.contains(it.id))};csv.copyTo(File(context.cacheDir,"reports/verification-shots.csv"),overwrite=true)}finally{csv.delete()}
  }finally{db.close()}
  Unit
 }
}
