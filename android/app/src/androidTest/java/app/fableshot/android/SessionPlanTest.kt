package app.fableshot.android
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
class SessionPlanTest {
 private lateinit var db:JournalDatabase
 private lateinit var repo:JournalRepository
 @Before fun setup(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build();repo=JournalRepository(db)}
 @After fun close()=runBlocking(Dispatchers.IO){db.close()}
 private suspend fun current()=repo.active.first()!!
 private fun saved(v:JournalWrite)=v as JournalWrite.Saved
 private suspend fun next(partial:Boolean=false,operation:String="next-${java.util.UUID.randomUUID()}"):JournalWrite {val e=current().currentEnd!!.end;return repo.next(e.id,e.revision,partial,operation)}
 @Test fun classicPracticeContinuesPastSixtyAndDoesNotPadShortSeries()=runBlocking(Dispatchers.IO) {
  val id=saved(repo.start("Classic",BlockPlan(18.0,400,seriesPerRound=10,flexibleSeries=true))).id
  assertEquals(JournalWrite.Rejected(WriteIssue.INCOMPLETE),next())
  repeat(20) { index ->
   val entry=current().currentEnd!!
   repeat(3) { saved(repo.numeric(entry.end.id,10)) }
   assertEquals(index%10==9,current().roundProgress().endsRound)
   saved(next())
  }
  val sixty=current()
  assertEquals(3,sixty.roundProgress().number)
  assertEquals(1,sixty.roundProgress().seriesNumber)
  assertEquals(60,sixty.allShots.size)
  assertEquals("active",sixty.session.state)
  saved(repo.numeric(sixty.currentEnd!!.end.id,9));saved(next())
  assertEquals(61,current().allShots.size)
  assertEquals(609,current().allShots.sumOf { it.points })
  assertEquals(1,current().roundProgress().ends.first().volume)
  repeat(13) { saved(repo.numeric(current().currentEnd!!.end.id,10)) }
  assertEquals(13,current().currentEnd!!.volume)
  assertEquals(13,current().currentEnd!!.end.plannedCount)
  saved(repo.complete(id,current().session.revision))
  val completed=repo.details(id)!!
  assertEquals(74,completed.allShots.size)
  assertEquals(22,completed.usedPlanEnds)
 }
 @Test fun completedTrainingResumesOnceWithItsExistingRoundsAndArrows()=runBlocking(Dispatchers.IO) {
  val id=saved(repo.start("Saved",BlockPlan(18.0,600,plannedEnds=1))).id
  repeat(3) { saved(repo.numeric(current().currentEnd!!.end.id,8)) }
  saved(next())
  val before=repo.details(id)!!
  saved(repo.resume(id,before.session.revision,"continue"))
  assertTrue(saved(repo.resume(id,before.session.revision,"continue")).replayed)
  val live=current()
  assertEquals(before.allShots,live.allShots)
  assertEquals(2,live.roundProgress().number)
  assertEquals(2,live.currentBlock!!.ends.size)
  assertNull(live.session.completedAtMs)
  saved(repo.complete(id,live.session.revision))
  assertEquals(before.allShots,repo.details(id)!!.allShots)
  assertEquals(1,repo.details(id)!!.currentBlock!!.ends.size)
 }
 @Test fun removingOldHitsCannotMoveTheNextRoundBackwards()=runBlocking(Dispatchers.IO) {
  val id=saved(repo.start("Stable rounds",BlockPlan(18.0,600,3,plannedEnds=2,roundCount=2))).id
  repeat(3) { saved(repo.numeric(current().currentEnd!!.end.id,10)) };saved(next())
  val shots=current().allShots.toList()
  for(shot in shots.asReversed()) saved(repo.removeShot(shot.id,shot.revision))
  assertEquals(2,current().roundProgress().number);assertEquals(1,current().usedPlanEnds)
  assertEquals(JournalWrite.Rejected(WriteIssue.INCOMPLETE),next(true))
  repeat(3) { saved(repo.numeric(current().currentEnd!!.end.id,9)) };saved(next())
  assertEquals("completed",repo.details(id)!!.session.state)
 }
 @Test fun twoRoundsAdvanceWithoutChangingConditionsAndStopAtPlan()=runBlocking(Dispatchers.IO) {
  val id=saved(repo.start("2 rounds",BlockPlan(18.0,600,3,plannedEnds=20,roundCount=2))).id
  repeat(20) { index ->
   val details=current();val progress=details.roundProgress()
   assertEquals(index/10+1,progress.number);assertEquals(index%10+1,progress.seriesNumber)
   assertEquals((index%10)*30,progress.maximum);assertEquals(30,progress.plannedArrowCount);assertEquals(2,progress.count)
   val end=details.currentEnd!!.end
   repeat(3) { saved(repo.numeric(end.id,if(index<10)10 else 8)) }
   val full=current()
   assertEquals(index==9,full.roundProgress().endsRound)
   assertEquals(index==19,full.finishesPlanOnNext)
   saved(next())
  }
  val complete=repo.details(id)!!
  assertEquals("completed",complete.session.state);assertEquals(20,complete.usedPlanEnds)
  assertEquals(1,complete.blocks.size);assertEquals(60,complete.allShots.size)
  assertEquals(2,complete.plans.single().roundCount)
 }
 @Test fun conditionChangesDoNotStartAnotherRound()=runBlocking(Dispatchers.IO) {
  val id=saved(repo.start("Mixed",BlockPlan(18.0,600,3,plannedEnds=20,roundCount=2))).id
  repeat(3) { saved(repo.numeric(current().currentEnd!!.end.id,9)) };saved(next())
  val session=current().session
  saved(repo.startBlock(id,BlockPlan(30.0,800,3),session.revision,true))
  assertEquals(1,current().roundProgress().number);assertEquals(2,current().roundProgress().seriesNumber)
  assertEquals(2,current().plans.single().roundCount)
 }
 @Test fun finalEndCompletesWithoutExtraEndAndRetryIsIdempotent()=runBlocking(Dispatchers.IO){
  val id=saved(repo.start("Plan",BlockPlan(18.0,600,3,plannedEnds=1))).id
  repeat(3){saved(repo.numeric(current().currentEnd!!.end.id,10))}
  val e=current().currentEnd!!.end;assertTrue(current().finishesPlanOnNext)
  saved(repo.next(e.id,e.revision,operationId="finish"));assertTrue(saved(repo.next(e.id,e.revision,operationId="finish")).replayed)
  val result=repo.details(id)!!;assertEquals("completed",result.session.state);assertEquals(1,result.blocks.single().ends.size);assertEquals(1,result.closedPlanEnds);assertEquals(30,result.allShots.sumOf{it.points});assertNull(repo.active.first())
 }
 @Test fun warmupExcludedAndPartialScoredEndCountsOnce()=runBlocking(Dispatchers.IO){
  val id=saved(repo.start("Warmup",BlockPlan(18.0,600,3,plannedEnds=1))).id
  var e=current().currentEnd!!.end;saved(repo.role(e.id,"warmup",e.revision));saved(repo.numeric(e.id,9));saved(next(true))
  assertEquals(0,current().usedPlanEnds)
  e=current().currentEnd!!.end;saved(repo.role(e.id,"scored",e.revision));saved(repo.numeric(e.id,8));saved(next(true))
  assertEquals("completed",repo.details(id)!!.session.state);assertEquals(1,repo.details(id)!!.closedPlanEnds);assertEquals(2,repo.details(id)!!.blocks.single().ends.size)
 }
 @Test fun zeroCountDoesNotSpendBudgetAndPositiveCountCompletes()=runBlocking(Dispatchers.IO){
  val id=saved(repo.start("Counter",BlockPlan(null,null,3,"count_only",plannedEnds=1))).id
  saved(next(true));assertEquals(0,current().usedPlanEnds)
  val e=current().currentEnd!!.end;saved(repo.setCount(e.id,2,e.revision));saved(next(true))
  val result=repo.details(id)!!;assertEquals("completed",result.session.state);assertEquals(1,result.closedPlanEnds);assertTrue(result.allShots.isEmpty())
 }
 @Test fun conditionsCannotResetOrBypassPlan()=runBlocking(Dispatchers.IO){
  val id=saved(repo.start("Blocks",BlockPlan(18.0,600,3,plannedEnds=2))).id
  saved(repo.numeric(current().currentEnd!!.end.id,10))
  var s=current().session;saved(repo.startBlock(id,BlockPlan(30.0,800,6,plannedEnds=200),s.revision,true))
  assertEquals(2,current().plannedEnds);assertEquals(1,current().closedPlanEnds)
  repeat(6){saved(repo.numeric(current().currentEnd!!.end.id,9))}
  s=current().session;assertEquals(JournalWrite.Rejected(WriteIssue.FULL),repo.startBlock(id,BlockPlan(18.0,600),s.revision))
  saved(next());assertEquals("completed",repo.details(id)!!.session.state);assertEquals(2,repo.details(id)!!.usedPlanEnds)
 }
 @Test fun boundsAndEarlyFinishPreserveUnfinishedPlan()=runBlocking(Dispatchers.IO){
  for(n in listOf(0,201))assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),repo.start("Bad",BlockPlan(18.0,600,plannedEnds=n)))
  val id=saved(repo.start("Early",BlockPlan(18.0,600,plannedEnds=200))).id
  saved(repo.numeric(current().currentEnd!!.end.id,0));val s=current().session;saved(repo.complete(id,s.revision))
  val result=repo.details(id)!!;assertEquals(200,result.plannedEnds);assertEquals(1,result.closedPlanEnds);assertEquals(1,result.allShots.size)
 }
}
