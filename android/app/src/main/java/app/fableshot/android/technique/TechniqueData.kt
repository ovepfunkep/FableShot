package app.fableshot.android.technique
import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.data.journal.*
import app.fableshot.android.data.WriteGate
import kotlinx.coroutines.flow.Flow
import org.json.*
import java.security.MessageDigest
import java.util.UUID

data class TechniqueStep(val id:String=UUID.randomUUID().toString(),val short:String="",val detail:String="",val children:String="",val visible:Boolean=true,val question:String="")
data class TechniquePhase(val id:String=UUID.randomUUID().toString(),val title:String="",val steps:List<TechniqueStep> = emptyList())
data class TechniqueText(val title:String="Новая памятка",val context:String="",val description:String="",val phases:List<TechniquePhase> = listOf("Подготовка","Выполнение","Завершение","Наблюдения").map{TechniquePhase(title=it)},val discussed:String?=null,val change:String="") {
 fun appendNotes(notes: String): TechniqueText {
  require(phases.size < 30)
  val chunks = notes.chunked(4000)
  require(chunks.size <= 50)
  val updated = copy(phases = phases + TechniquePhase(
   title = "Мои записи",
   steps = chunks.map { TechniqueStep(detail = it) }
  ))
  parse(updated.json(), allowDraft = true)
  return updated
 }
 fun json():String=JSONObject().put("schema",1).put("title",title).put("context",context).put("description",description).put("discussed",discussed?:JSONObject.NULL).put("change",change).put("phases",JSONArray(phases.map{p->JSONObject().put("id",p.id).put("title",p.title).put("steps",JSONArray(p.steps.map{s->JSONObject().put("id",s.id).put("short",s.short).put("detail",s.detail).put("children",s.children).put("visible",s.visible).put("question",s.question)}))})).toString()
 companion object {
  fun parse(raw:String,allowDraft:Boolean=false):TechniqueText {
   require(raw.length<=262144);val o=JSONObject(raw);require(o.getInt("schema")==1)
   val phases=o.getJSONArray("phases");require(phases.length()<=30)
   val ps=(0 until phases.length()).map{i->val p=phases.getJSONObject(i);val steps=p.getJSONArray("steps");require(steps.length()<=50);TechniquePhase(p.getString("id"),p.getString("title"),(0 until steps.length()).map{j->val s=steps.getJSONObject(j);TechniqueStep(s.getString("id"),s.getString("short"),s.getString("detail"),s.getString("children"),s.getBoolean("visible"),s.getString("question"))})}
   val result=TechniqueText(o.getString("title"),o.getString("context"),o.getString("description"),ps,if(o.isNull("discussed"))null else o.getString("discussed"),o.getString("change"))
   require((allowDraft||result.title.isNotBlank())&&result.title.length<=100&&result.context.length<=200&&result.description.length<=4000&&result.change.length<=1000)
   require(ps.map{it.id}.distinct().size==ps.size&&ps.all{it.id.isNotBlank()&&it.title.length<=100&&it.steps.map{it.id}.distinct().size==it.steps.size&&it.steps.all{s->s.id.isNotBlank()&&s.short.length<=200&&s.detail.length<=4000&&s.children.length<=4000&&s.question.length<=1000}})
   result.discussed?.let{java.time.LocalDate.parse(it)};return result
  }
 }
}
@Entity(tableName="technique_documents")
data class TechniqueDocument(@PrimaryKey val id:String,val draftJson:String,val updatedAtMs:Long,val archived:Boolean=false,val isPrimary:Boolean=false)
@Entity(tableName="technique_versions",foreignKeys=[ForeignKey(entity=TechniqueDocument::class,parentColumns=["id"],childColumns=["documentId"],onDelete=ForeignKey.CASCADE)],indices=[Index(value=["documentId","number"],unique=true)])
data class TechniqueVersion(@PrimaryKey val id:String,val documentId:String,val number:Int,val createdAtMs:Long,val payloadJson:String)
@Entity(tableName="technique_uses",foreignKeys=[ForeignKey(entity=JournalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.CASCADE),ForeignKey(entity=TechniqueVersion::class,parentColumns=["id"],childColumns=["versionId"])],indices=[Index(value=["sessionId","sequence"],unique=true),Index("versionId")])
data class TechniqueUse(@PrimaryKey val id:String,val sessionId:String,val versionId:String?,val sequence:Int,val blockOrdinal:Int,val endOrdinal:Int,val focus1:String,val focus2:String,val createdAtMs:Long,val worked:String="",val question:String="",val rating:String?=null,val revision:Long=1)
data class TechniqueDocumentDetails(@Embedded val document:TechniqueDocument,@Relation(parentColumn="id",entityColumn="documentId")val versions:List<TechniqueVersion>){val latest get()=versions.maxByOrNull{it.number}}
data class TechniqueSelection(val versionId:String?,val focus1:String="",val focus2:String="",val operationId:String=UUID.randomUUID().toString()) {
 fun json()=JSONObject().put("version",versionId?:JSONObject.NULL).put("f1",focus1).put("f2",focus2).put("op",operationId).toString()
 companion object{fun parse(raw:String):TechniqueSelection{val o=JSONObject(raw);return TechniqueSelection(if(o.isNull("version"))null else o.getString("version"),o.getString("f1"),o.getString("f2"),o.getString("op"))}}
}
@Dao interface TechniqueDao {
 @Transaction @Query("SELECT * FROM technique_documents ORDER BY isPrimary DESC,updatedAtMs DESC") fun observe():Flow<List<TechniqueDocumentDetails>>
 @Query("SELECT * FROM technique_documents WHERE id=:id") suspend fun document(id:String):TechniqueDocument?
 @Query("SELECT * FROM technique_versions WHERE id=:id") suspend fun version(id:String):TechniqueVersion?
 @Query("SELECT * FROM technique_versions WHERE documentId=:id ORDER BY number DESC LIMIT 1") suspend fun latest(id:String):TechniqueVersion?
 @Query("""SELECT DISTINCT receipt.payloadHash FROM mutation_receipts AS receipt
     JOIN technique_versions AS version ON version.id = receipt.resultId
         AND version.documentId = receipt.sessionId AND version.number = receipt.resultRevision
     WHERE receipt.kind = 'technique_publish' AND receipt.sessionId = :documentId""")
 suspend fun achievementPublicationFingerprints(documentId: String): List<String>
 @Query("SELECT * FROM technique_uses WHERE sessionId=:id ORDER BY sequence") fun uses(id:String):Flow<List<TechniqueUse>>
 @Query("SELECT * FROM technique_uses WHERE id=:id") suspend fun use(id:String):TechniqueUse?
 @Query("SELECT COALESCE(MAX(sequence),0)+1 FROM technique_uses WHERE sessionId=:id") suspend fun nextSequence(id:String):Int
 @Insert suspend fun insert(v:TechniqueDocument)
 @Insert suspend fun insert(v:TechniqueVersion)
 @Insert suspend fun insert(v:TechniqueUse)
 @Update suspend fun update(v:TechniqueDocument)
 @Update suspend fun update(v:TechniqueUse)
 @Query("UPDATE technique_documents SET isPrimary=0") suspend fun clearPrimary()
}
class TechniqueRepository(
 private val db: JournalDatabase,
 private val gate: WriteGate,
 private val onAchievementPublication: (suspend (ruleId: String, operationId: String) -> Unit)? = null,
) {
 private val dao=db.techniqueDao();val library=dao.observe()
 fun uses(id:String)=dao.uses(id)
 private suspend fun <T> write(action:suspend()->T):T=gate.write{db.withTransaction{action()}}
 suspend fun create(text:TechniqueText=TechniqueText()):String=write{val id=UUID.randomUUID().toString();val raw=text.copy(discussed=null).json();TechniqueText.parse(raw,true);dao.insert(TechniqueDocument(id,raw,System.currentTimeMillis()));id}
 suspend fun draft(id:String,expected:String,raw:String)=write{TechniqueText.parse(raw,true);val d=requireNotNull(dao.document(id));check(!d.archived&&(d.draftJson==expected||d.draftJson==raw)){"Памятка изменена. Переоткрой редактор."};if(d.draftJson!=raw)dao.update(d.copy(draftJson=raw,updatedAtMs=System.currentTimeMillis()))}
 suspend fun publish(id: String, expected: String, raw: String, countForAchievements: Boolean = true): TechniqueVersion = write {
  val text = TechniqueText.parse(raw)
  val document = requireNotNull(dao.document(id))
  check(!document.archived && (document.draftJson == expected || document.draftJson == raw)) {
   "Памятка изменена. Переоткрой редактор."
  }
  val latest = dao.latest(id)
  val now = System.currentTimeMillis()
  val nextDraft = text.copy(discussed = null, change = "").json()
  val version = TechniqueVersion(UUID.randomUUID().toString(), id, (latest?.number ?: 0) + 1, now, raw)
  dao.insert(version)
  dao.update(document.copy(draftJson = nextDraft, updatedAtMs = now))

  val notify = onAchievementPublication ?: return@write version
  if (!countForAchievements) return@write version
  val content = text.achievementContent()
  if (content.description.isBlank() && content.phases.isEmpty()) return@write version
  val previous = latest?.let { TechniqueText.parse(it.payloadJson).achievementContent() }
  if (content == previous) return@write version
  val fingerprint = MessageDigest.getInstance("SHA-256").digest(content.json().toByteArray(Charsets.UTF_8))
   .joinToString("") { "%02x".format(it) }
  val published = dao.achievementPublicationFingerprints(id)
  if (fingerprint in published) return@write version

  val operationId = "technique_publish:${version.id}"
  // This namespace records a document mutation; training receipt queries only use training kinds.
  db.journalDao().insert(MutationReceipt(operationId, id, "technique_publish", fingerprint,
   version.id, version.number.toLong(), now))
  notify("MIND03", operationId)
  if (published.isNotEmpty()) notify("MIND04", operationId)
  version
 }
 suspend fun archive(id:String,value:Boolean)=write{val d=requireNotNull(dao.document(id));dao.update(d.copy(archived=value,isPrimary=if(value)false else d.isPrimary))}
 suspend fun primary(id:String)=write{val d=requireNotNull(dao.document(id));check(!d.archived&&dao.latest(id)!=null);dao.clearPrimary();dao.update(d.copy(isPrimary=true))}
 suspend fun bind(sessionId:String,selection:TechniqueSelection):TechniqueUse=write{bindTechnique(db,sessionId,selection)}
 suspend fun reflect(id:String,revision:Long,worked:String,question:String,rating:String?)=write{val u=requireNotNull(dao.use(id));check(u.revision==revision);require(worked.length<=4000&&question.length<=4000&&rating in listOf(null,"yes","unstable","untracked"));dao.update(u.copy(worked=worked,question=question,rating=rating,revision=u.revision+1))}
}

private val achievementWhitespace = Regex("\\s+")

/** Only authored card content participates in the version comparison. */
private fun TechniqueText.achievementContent(): TechniqueText {
 fun String.normalized() = trim().replace(achievementWhitespace, " ")
 val contentPhases = phases.mapNotNull { phase ->
  val contentSteps = phase.steps.map { step ->
   step.copy(id = "", short = step.short.normalized(), detail = step.detail.normalized(),
    children = step.children.normalized(), question = step.question.normalized(), visible = true)
  }.filter { it.short.isNotEmpty() || it.detail.isNotEmpty() || it.children.isNotEmpty() || it.question.isNotEmpty() }
  contentSteps.takeIf { it.isNotEmpty() }?.let { phase.copy(id = "", title = phase.title.normalized(), steps = it) }
 }
 return copy(title = title.normalized(), context = context.normalized(), description = description.normalized(),
  phases = contentPhases, discussed = null, change = "")
}
/** Caller owns the Room transaction; also used by atomic training creation. */
suspend fun bindTechnique(db:JournalDatabase,sessionId:String,selection:TechniqueSelection):TechniqueUse {
 val dao=db.techniqueDao();val id=UUID.nameUUIDFromBytes(("technique:"+sessionId+":"+selection.operationId).toByteArray()).toString()
 dao.use(id)?.let{check(it.sessionId==sessionId&&it.versionId==selection.versionId&&it.focus1==selection.focus1&&it.focus2==selection.focus2);return it}
 val session=requireNotNull(db.journalDao().session(sessionId));check(session.deletedAtMs==null&&session.state=="active")
 selection.versionId?.let{requireNotNull(dao.version(it))};require(selection.focus1.length<=200&&selection.focus2.length<=200&&selection.operationId.length in 1..128)
 val details=requireNotNull(db.journalDao().details(sessionId));val use=TechniqueUse(id,sessionId,selection.versionId,dao.nextSequence(sessionId),details.currentBlock?.block?.ordinal?:0,details.currentEnd?.end?.ordinal?:0,selection.focus1,selection.focus2,System.currentTimeMillis());dao.insert(use);return use
}
val MIGRATION_5_6=object:Migration(5,6){override fun migrate(db:SupportSQLiteDatabase){
 db.execSQL("CREATE TABLE IF NOT EXISTS technique_documents (id TEXT NOT NULL PRIMARY KEY,draftJson TEXT NOT NULL,updatedAtMs INTEGER NOT NULL,archived INTEGER NOT NULL,isPrimary INTEGER NOT NULL)")
 db.execSQL("CREATE TABLE IF NOT EXISTS technique_versions (id TEXT NOT NULL PRIMARY KEY,documentId TEXT NOT NULL,number INTEGER NOT NULL,createdAtMs INTEGER NOT NULL,payloadJson TEXT NOT NULL,FOREIGN KEY(documentId) REFERENCES technique_documents(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
 db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_technique_versions_documentId_number ON technique_versions(documentId,number)")
 db.execSQL("CREATE TABLE IF NOT EXISTS technique_uses (id TEXT NOT NULL PRIMARY KEY,sessionId TEXT NOT NULL,versionId TEXT,sequence INTEGER NOT NULL,blockOrdinal INTEGER NOT NULL,endOrdinal INTEGER NOT NULL,focus1 TEXT NOT NULL,focus2 TEXT NOT NULL,createdAtMs INTEGER NOT NULL,worked TEXT NOT NULL,question TEXT NOT NULL,rating TEXT,revision INTEGER NOT NULL,FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE,FOREIGN KEY(versionId) REFERENCES technique_versions(id) ON UPDATE NO ACTION ON DELETE NO ACTION)")
 db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_technique_uses_sessionId_sequence ON technique_uses(sessionId,sequence)")
 db.execSQL("CREATE INDEX IF NOT EXISTS index_technique_uses_versionId ON technique_uses(versionId)")
}}
