package app.fableshot.android
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.analyticsRows
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.TargetPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
class AnalyticsBlocksTest {
 private lateinit var db:JournalDatabase
 private lateinit var repo:JournalRepository
 @Before fun setup(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build();repo=JournalRepository(db)}
 @After fun close()=runBlocking(Dispatchers.IO){db.close()}
 private suspend fun current()=repo.active.first()!!
 private fun saved(v:JournalWrite){assertTrue(v.toString(),v is JournalWrite.Saved)}
 private suspend fun block(p:BlockPlan){val s=current().session;saved(repo.startBlock(s.id,p,s.revision,true))}
 @Test fun returningToSameConditionsProducesOnePointPerSessionAndGroup()=runBlocking(Dispatchers.IO){
  val a=BlockPlan(18.0,600);saved(repo.start("Mixed",a));saved(repo.point(current().currentEnd!!.end.id,TargetPoint(.1,0.0)))
  block(a.copy(distanceMeters=30.0));saved(repo.numeric(current().currentEnd!!.end.id,8))
  block(a);saved(repo.point(current().currentEnd!!.end.id,TargetPoint(.2,0.0)))
  val s=current().session;saved(repo.complete(s.id,s.revision))
  val rows=analyticsRows(listOf(repo.details(s.id)!!.summary()));assertEquals(2,rows.size);assertTrue(rows.all{it.comparable&&it.id==s.id})
  val short=rows.single{it.distanceMeters==18.0};assertEquals(2,short.scoredCount);assertEquals(19,short.total);assertEquals(2,short.journalMeta!!.positions!!.size);assertNull(short.journalMeta!!.progressPercentagePoints)
  assertEquals(27,rows.sumOf{it.total});assertEquals(3,rows.sumOf{it.scoredCount})
 }
 @Test fun counterAndWarmupNeverPolluteScoredBlock()=runBlocking(Dispatchers.IO){
  saved(repo.start("Counter",BlockPlan(null,null,3,"count_only")));var e=current().currentEnd!!.end;saved(repo.setCount(e.id,3,e.revision))
  block(BlockPlan(18.0,600));e=current().currentEnd!!.end;saved(repo.role(e.id,"warmup",e.revision));saved(repo.numeric(e.id,10));e=current().currentEnd!!.end;saved(repo.next(e.id,e.revision,true));e=current().currentEnd!!.end;saved(repo.role(e.id,"scored",e.revision));saved(repo.numeric(e.id,8))
  val s=current().session;saved(repo.complete(s.id,s.revision));val rows=analyticsRows(listOf(repo.details(s.id)!!.summary())).filter{it.comparable&&it.scoredCount>0}
  assertEquals(1,rows.size);assertEquals(1,rows.single().scoredCount);assertEquals(8,rows.single().total)
 }
}
