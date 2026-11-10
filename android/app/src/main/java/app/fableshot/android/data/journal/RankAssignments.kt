package app.fableshot.android.data.journal

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.data.WriteGate
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate
import java.util.UUID

/** User-entered assignment facts. No training calculation writes this table. */
@Entity(tableName="rank_assignments",indices=[Index(value=["discipline","category"])])
data class RankAssignment(
    @PrimaryKey val id:String=UUID.randomUUID().toString(),
    val discipline:String="recurve",
    val category:String="male",
    val level:String="III",
    val assignedOn:String?=null,
    val issuedBy:String="",
    val reference:String="",
    val current:Boolean=true,
    val createdAtMs:Long=System.currentTimeMillis(),
    val updatedAtMs:Long=createdAtMs,
    val revision:Long=0,
    val deletedAtMs:Long?=null,
) {
    fun valid():Boolean = id.length in 1..128 && id.none { it.code<32 } && discipline in rankDisciplines &&
        category in setOf("male","female") && level in rankLevels &&
        (assignedOn==null || runCatching { LocalDate.parse(assignedOn).toString()==assignedOn }.getOrDefault(false)) &&
        issuedBy.length<=120 && reference.length<=500 && revision>=0
}

val rankDisciplines=linkedMapOf("recurve" to "КЛ","barebow" to "КЛб","compound" to "БЛ",
    "3d-recurve" to "3Д · КЛ","3d-compound" to "3Д · БЛ","3d-traditional" to "3Д · составной лук","3d-longbow" to "3Д · длинный лук")
val rankLevels=listOf("III юн.","II юн.","I юн.","III","II","I","КМС","МС","МСМК")

@Dao
interface RankAssignmentDao {
    @Query("SELECT * FROM rank_assignments WHERE deletedAtMs IS NULL ORDER BY current DESC,assignedOn DESC,createdAtMs DESC,id")
    fun observe():Flow<List<RankAssignment>>
    @Query("SELECT * FROM rank_assignments WHERE id=:id") suspend fun get(id:String):RankAssignment?
    @Insert suspend fun insert(value:RankAssignment)
    @Update suspend fun update(value:RankAssignment)
    @Query("UPDATE rank_assignments SET current=0,revision=revision+1,updatedAtMs=:now WHERE id<>:exceptId AND discipline=:discipline AND category=:category AND current=1 AND deletedAtMs IS NULL")
    suspend fun retirePrevious(discipline:String,category:String,exceptId:String,now:Long)
}

class RankAssignmentConflict:IllegalStateException("Rank assignment changed; reopen the record")

class RankAssignmentRepository(private val db:JournalDatabase,private val gate:WriteGate=WriteGate()) {
    private val dao=db.rankAssignmentDao()
    val records=dao.observe()
    suspend fun save(value:RankAssignment):RankAssignment = gate.write {
        require(value.valid() && value.deletedAtMs==null)
        db.withTransaction {
            val old=dao.get(value.id)
            if(old?.deletedAtMs!=null || (old==null && value.revision!=0L)) throw RankAssignmentConflict()
            if(old!=null && old.revision!=value.revision) {
                if(old.copy(updatedAtMs=value.updatedAtMs,revision=value.revision)==value) return@withTransaction old
                throw RankAssignmentConflict()
            }
            val now=System.currentTimeMillis()
            val next=value.copy(createdAtMs=old?.createdAtMs ?: value.createdAtMs,updatedAtMs=now,revision=(old?.revision ?: 0)+1)
            if(next.current) dao.retirePrevious(next.discipline,next.category,next.id,now)
            if(old==null) dao.insert(next) else dao.update(next)
            next
        }
    }
    suspend fun remove(value:RankAssignment) = gate.write {
        db.withTransaction {
            val old=dao.get(value.id) ?: throw RankAssignmentConflict()
            if(old.deletedAtMs!=null) return@withTransaction
            if(old.revision!=value.revision) throw RankAssignmentConflict()
            val now=System.currentTimeMillis()
            dao.update(old.copy(current=false,deletedAtMs=now,updatedAtMs=now,revision=old.revision+1))
        }
    }
}

val MIGRATION_7_8=object:Migration(7,8) {
    override fun migrate(db:SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS rank_assignments (id TEXT NOT NULL PRIMARY KEY,discipline TEXT NOT NULL,category TEXT NOT NULL,level TEXT NOT NULL,assignedOn TEXT,issuedBy TEXT NOT NULL,reference TEXT NOT NULL,current INTEGER NOT NULL,createdAtMs INTEGER NOT NULL,updatedAtMs INTEGER NOT NULL,revision INTEGER NOT NULL,deletedAtMs INTEGER)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_rank_assignments_discipline_category ON rank_assignments(discipline,category)")
    }
}
