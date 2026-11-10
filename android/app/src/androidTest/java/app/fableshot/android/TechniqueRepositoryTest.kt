package app.fableshot.android
import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.technique.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
class TechniqueRepositoryTest {
 private lateinit var db:JournalDatabase
 private lateinit var repo:TechniqueRepository
 @Before fun setup(){db=Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext,JournalDatabase::class.java).build();repo=TechniqueRepository(db,WriteGate())}
 @After fun close()=runBlocking(Dispatchers.IO){db.close()}
 private suspend fun create():TechniqueVersion {val text=TechniqueText(title="Мои заметки",phases=listOf(TechniquePhase(title="Подготовка",steps=listOf(TechniqueStep(short="Фокус",detail="Полный текст",children="Пункт 1\nПункт 2",question="Уточнить")))),discussed="2026-10-30");val id=repo.create(text);val doc=repo.library.first().single().document;return repo.publish(id,doc.draftJson,text.json())}
 @Test fun pastedNotesAreNotTruncatedOrInterpreted() {
  val notes = "Мой длинный текст\n".repeat(600)
  val result = TechniqueText().appendNotes(notes)
  assertEquals(notes, result.phases.last().steps.joinToString("") { it.detail })
  assertTrue(result.phases.last().steps.all { it.short.isEmpty() })
 }
 @Test fun versionsDraftAndDiscussionAreIndependent()=runBlocking(Dispatchers.IO){
  val old=create();val d=repo.library.first().single().document
  assertNull(TechniqueText.parse(d.draftJson).discussed)
  val changed=TechniqueText.parse(d.draftJson).copy(title="Изменено").json();repo.draft(d.id,d.draftJson,changed)
  try{repo.draft(d.id,d.draftJson,TechniqueText(title="Чужая правка").json());fail()}catch(_:IllegalStateException){}
  repo.publish(d.id,changed,changed);val versions=repo.library.first().single().versions
  assertEquals(2,versions.size);assertEquals(old,versions.single{it.id==old.id});assertEquals("2026-10-30",TechniqueText.parse(old.payloadJson).discussed)
 }
 @Test fun trainingCreationAndBindingAreAtomicAndIdempotent()=runBlocking(Dispatchers.IO){
  val version=create();val journal=JournalRepository(db);val selection=TechniqueSelection(version.id,"Фокус")
  val plan=BlockPlan(18.0,600,techniqueSelection=selection)
  val started=journal.start("С техникой",plan,"start") as JournalWrite.Saved
  journal.start("С техникой",plan,"start");assertEquals(1,repo.uses(started.id).first().size)
  repo.bind(started.id,selection);assertEquals(1,repo.uses(started.id).first().size)
  val d=repo.library.first().single().document;val changed=TechniqueText.parse(d.draftJson).copy(title="Позже").json();repo.publish(d.id,d.draftJson,changed)
  val use=repo.uses(started.id).first().single();assertEquals(version.id,use.versionId)
  repo.reflect(use.id,use.revision,"Получилось","Спросить","yes");assertEquals("Спросить",repo.uses(started.id).first().single().question)
 }
 @Test fun invalidBindingDoesNotLeaveHalfCreatedSession()=runBlocking(Dispatchers.IO){
  try{JournalRepository(db).start("Не сохранить наполовину",BlockPlan(18.0,600,techniqueSelection=TechniqueSelection("missing")));fail()}catch(_:IllegalArgumentException){}
  assertNull(JournalRepository(db).active.first())
 }
 @Test fun archivedVersionRemainsAvailableAndPrimaryIsUnique()=runBlocking(Dispatchers.IO){
  val a=create();repo.primary(a.documentId);val bId=repo.create(TechniqueText(title="Другой лук"));val b=repo.library.first().first{it.document.id==bId}.document;repo.publish(bId,b.draftJson,b.draftJson);repo.primary(bId)
  assertEquals(1,repo.library.first().count{it.document.isPrimary});repo.archive(a.documentId,true);assertEquals(a,repo.library.first().first{it.document.id==a.documentId}.versions.single())
 }
}
