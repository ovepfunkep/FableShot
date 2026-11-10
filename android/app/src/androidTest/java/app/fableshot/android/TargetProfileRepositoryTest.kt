package app.fableshot.android
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
class TargetProfileRepositoryTest {
 private lateinit var db:JournalDatabase
 private lateinit var repo:JournalRepository
 private var instant=1000L
 @Before fun setup(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build();repo=JournalRepository(db,now={instant++})}
 @After fun close()=runBlocking(Dispatchers.IO){db.close()}
 private suspend fun current()=repo.active.first()!!
 private fun saved(v:JournalWrite)=v as JournalWrite.Saved
 private fun plan(p:TargetProfile,arrows:Int=3)=BlockPlan(18.0,p.diameters.firstOrNull()?:600,arrows,equipmentSnapshotJson="{\"bow\":{\"category\":\"barebow\"}}",targetProfileId=p.id)
 @Test fun profileIsFrozenAndScoringUsesItsGeometry()=runBlocking(Dispatchers.IO){
  saved(repo.start("Inner",plan(TargetCatalog.compound)));val before=current().currentBlock!!.block;val e=current().currentEnd!!.end.id
  saved(repo.point(e,TargetPoint(.075,0.0)));assertEquals(9,current().allShots.single().points)
  val s=current().session;saved(repo.startBlock(s.id,plan(TargetCatalog.outdoor),s.revision,true))
  assertEquals(before,current().orderedBlocks.first().block);assertEquals(TargetCatalog.outdoor,current().currentBlock!!.block.verifiedTarget());assertTrue(current().currentBlock!!.scoringInput().geometryVerified)
 }
 @Test fun xNumericAndGeometryEditsSurvivePresentationAndUndo()=runBlocking(Dispatchers.IO){
  saved(repo.start("X",plan(TargetCatalog.outdoor)));val e=current().currentEnd!!.end.id
  saved(repo.numericX(e,"X-operation"));assertTrue(saved(repo.numericX(e,"X-operation")).replayed)
  var shot=current().allShots.single();assertEquals("X",shot.presentation().zoneCode);assertEquals(10,shot.points)
  saved(repo.revise(shot.copy(x=.08,y=0.0,positionStatus="known",positionSource="manual_target",scoreSource="target_computed")))
  shot=current().allShots.single();assertEquals("10",shot.zoneCode)
  saved(repo.revise(shot.copy(x=.02,y=0.0)));shot=current().allShots.single();assertEquals("X",shot.zoneCode)
  saved(repo.removeShot(shot.id,shot.revision));assertTrue(current().allShots.isEmpty())
 }
 @Test fun reducedFaceRejectsImpossibleNumericScores()=runBlocking(Dispatchers.IO){
  saved(repo.start("Reduced",plan(TargetCatalog.reduced)));val e=current().currentEnd!!.end.id
  assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),repo.numeric(e,4));saved(repo.point(e,TargetPoint(.61,0.0)));assertEquals(0,current().allShots.single().points)
 }
 @Test fun unsupportedXAndDiameterAreRejectedWithoutWrites()=runBlocking(Dispatchers.IO){
  assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),repo.start("Bad",plan(TargetCatalog.outdoor).copy(diameterMm=400)))
  saved(repo.start("Indoor",plan(TargetCatalog.indoor)));assertEquals(JournalWrite.Rejected(WriteIssue.INVALID),repo.numericX(current().currentEnd!!.end.id));assertTrue(current().allShots.isEmpty())
 }
 @Test fun progressUsesOnlyExactlyMatchingTargetProfiles()=runBlocking(Dispatchers.IO){
  val p=plan(TargetCatalog.outdoor,12)
  repeat(3){saved(repo.start("Past",p));repeat(12){saved(repo.numeric(current().currentEnd!!.end.id,8))};val s=current().session;saved(repo.complete(s.id,s.revision));instant+=1000}
  saved(repo.start("Same",p));assertEquals("ready",current().currentBlock!!.baselines.single().status);var s=current().session;saved(repo.complete(s.id,s.revision));instant+=1000
  saved(repo.start("Different",plan(TargetCatalog.reduced,12)));assertEquals(0,current().currentBlock!!.baselines.single().scoredCount)
 }
 @Test fun changedSnapshotIsNeverTreatedAsVerified()=runBlocking(Dispatchers.IO){
  saved(repo.start("Snapshot",plan(TargetCatalog.outdoor)));val b=current().currentBlock!!.block
  assertNotNull(b.verifiedTarget());assertNull(b.copy(targetSnapshotJson=b.targetSnapshotJson!!.replace("0.05","0.06")).verifiedTarget())
 }
}
