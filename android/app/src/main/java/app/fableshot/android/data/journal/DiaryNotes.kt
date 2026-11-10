package app.fableshot.android.data.journal

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.data.WriteGate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import java.time.LocalDate
import java.util.UUID

data class NoteScope(val sessionId:String?=null,val blockId:String?=null,val endId:String?=null) {
    fun valid()=(blockId==null || sessionId!=null) && (endId==null || blockId!=null)
}

@Entity(tableName="diary_notes",foreignKeys=[
    ForeignKey(entity=JournalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.SET_NULL),
    ForeignKey(entity=JournalBlock::class,parentColumns=["id"],childColumns=["blockId"],onDelete=ForeignKey.SET_NULL),
    ForeignKey(entity=JournalEnd::class,parentColumns=["id"],childColumns=["endId"],onDelete=ForeignKey.SET_NULL),
],indices=[Index("sessionId"),Index("blockId"),Index("endId")])
data class DiaryNote(
    @PrimaryKey val id:String=UUID.randomUUID().toString(),
    val sessionId:String?=null,val blockId:String?=null,val endId:String?=null,
    val localDate:String=LocalDate.now().toString(),
    val body:String="",val tagsJson:String="[]",val place:String="",val feeling:String="",val conditions:String="",
    val createdAtMs:Long=System.currentTimeMillis(),val updatedAtMs:Long=createdAtMs,
    val revision:Long=0,val deletedAtMs:Long?=null,
) {
    fun scope()=NoteScope(sessionId,blockId,endId)
    fun valid():Boolean {
        val tags=runCatching {NoteTags.decode(tagsJson)}.getOrNull() ?: return false
        return id.length in 1..128 && id.none {it.code<32} && scope().valid() &&
            runCatching {LocalDate.parse(localDate).toString()==localDate}.getOrDefault(false) &&
            body.length<=8000 && place.length<=120 && feeling.length<=240 && conditions.length<=500 && revision>=0 &&
            (body.isNotBlank() || place.isNotBlank() || feeling.isNotBlank() || conditions.isNotBlank() || tags.isNotEmpty())
    }
}

object NoteTags {
    fun encode(text:String):String {
        val values=text.split(',').map {it.trim()}.filter {it.isNotEmpty()}.distinctBy {it.lowercase(java.util.Locale.ROOT)}
        val json=JSONArray(values).toString();decode(json);return json
    }
    fun decode(json:String):List<String> {
        require(json.length<=4096)
        val source=JSONArray(json);require(source.length()<=12)
        val tags=(0 until source.length()).map { index ->
            val value=source.opt(index) as? String ?: error("Invalid tag")
            require(value.length in 1..30 && value==value.trim() && value.none {it.code<32 || it==','});value
        }
        require(tags.distinctBy {it.lowercase(java.util.Locale.ROOT)}.size==tags.size)
        return tags
    }
}

@Dao
interface DiaryNoteDao {
    @Query("SELECT * FROM diary_notes WHERE deletedAtMs IS NULL ORDER BY localDate DESC,createdAtMs DESC,id")
    fun observe():Flow<List<DiaryNote>>
    @Query("SELECT * FROM diary_notes WHERE id=:id") suspend fun get(id:String):DiaryNote?
    @Insert suspend fun insert(value:DiaryNote)
    @Update suspend fun update(value:DiaryNote)
}

class DiaryNoteConflict:IllegalStateException("Diary note changed; reopen it")

class DiaryNoteRepository(private val db:JournalDatabase,private val gate:WriteGate=WriteGate()) {
    private val dao=db.diaryNoteDao()
    val notes=dao.observe()
    fun notes(scope:NoteScope):Flow<List<DiaryNote>> = notes.map { rows ->rows.filter { note ->
        (scope.sessionId==null || note.sessionId==scope.sessionId) &&
        (scope.blockId==null || note.blockId==scope.blockId) && (scope.endId==null || note.endId==scope.endId)
    } }
    suspend fun source(scope:NoteScope):JournalDetails?=scope.sessionId?.let {db.journalDao().details(it)}
    suspend fun save(value:DiaryNote):DiaryNote = gate.write {
        require(value.valid() && value.deletedAtMs==null)
        db.withTransaction {
            val source=source(value.scope())
            if(value.sessionId!=null)require(source!=null)
            if(value.blockId!=null)require(source!!.blocks.any {it.block.id==value.blockId})
            if(value.endId!=null)require(source!!.blocks.first {it.block.id==value.blockId}.ends.any {it.end.id==value.endId})
            val old=dao.get(value.id)
            if(old?.deletedAtMs!=null || (old==null && value.revision!=0L))throw DiaryNoteConflict()
            if(old!=null && old.revision!=value.revision) {
                if(old.copy(updatedAtMs=value.updatedAtMs,revision=value.revision)==value)return@withTransaction old
                throw DiaryNoteConflict()
            }
            val next=value.copy(createdAtMs=old?.createdAtMs ?: value.createdAtMs,updatedAtMs=System.currentTimeMillis(),revision=(old?.revision ?: 0)+1)
            if(old==null)dao.insert(next)else dao.update(next)
            next
        }
    }
    suspend fun remove(value:DiaryNote) = gate.write {
        db.withTransaction {
            val old=dao.get(value.id) ?: throw DiaryNoteConflict()
            if(old.deletedAtMs!=null)return@withTransaction
            if(old.revision!=value.revision)throw DiaryNoteConflict()
            val now=System.currentTimeMillis()
            dao.update(old.copy(deletedAtMs=now,updatedAtMs=now,revision=old.revision+1))
        }
    }
}

val MIGRATION_8_9=object:Migration(8,9) {
    override fun migrate(db:SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS diary_notes (id TEXT NOT NULL PRIMARY KEY,sessionId TEXT,blockId TEXT,endId TEXT,localDate TEXT NOT NULL,body TEXT NOT NULL,tagsJson TEXT NOT NULL,place TEXT NOT NULL,feeling TEXT NOT NULL,conditions TEXT NOT NULL,createdAtMs INTEGER NOT NULL,updatedAtMs INTEGER NOT NULL,revision INTEGER NOT NULL,deletedAtMs INTEGER,FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE SET NULL,FOREIGN KEY(blockId) REFERENCES blocks(id) ON UPDATE NO ACTION ON DELETE SET NULL,FOREIGN KEY(endId) REFERENCES ends(id) ON UPDATE NO ACTION ON DELETE SET NULL)")
        for(column in listOf("sessionId","blockId","endId"))db.execSQL("CREATE INDEX IF NOT EXISTS index_diary_notes_$column ON diary_notes($column)")
    }
}
