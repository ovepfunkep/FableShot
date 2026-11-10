package app.fableshot.android.importing

import androidx.room.*
import app.fableshot.android.data.journal.JournalSession
import app.fableshot.android.data.journal.JournalEnd

@Entity(tableName="import_batches",indices=[Index(value=["fileHash"],unique=true)])
data class ImportBatch(@PrimaryKey val id:String,val source:String,val fileHash:String,val parserVersion:String,val importedAtMs:Long,val sourceName:String?,val rawSourcePath:String,val status:String)

@Entity(tableName="imported_groups",foreignKeys=[
    ForeignKey(entity=ImportBatch::class,parentColumns=["id"],childColumns=["batchId"],onDelete=ForeignKey.CASCADE),
    ForeignKey(entity=JournalSession::class,parentColumns=["id"],childColumns=["sessionId"],onDelete=ForeignKey.CASCADE),
],indices=[Index("batchId"),Index(value=["sessionId"],unique=true),Index("rawFingerprint"),Index("importOperationId")])
data class ImportedGroup(@PrimaryKey val id:String,val batchId:String,val sourceGroupKey:String,val rawFingerprint:String,val sessionId:String,val mappingVersion:String,val mappingJson:String,val importOperationId:String,val firstRecord:Int,val lastRecord:Int,val endFingerprintsJson:String)

/** Shot ID intentionally has no FK: deleting a shot must not erase the source deduplication marker. */
@Entity(tableName="imported_rows",primaryKeys=["batchId","sourceRecord"],foreignKeys=[
    ForeignKey(entity=ImportBatch::class,parentColumns=["id"],childColumns=["batchId"],onDelete=ForeignKey.CASCADE),
    ForeignKey(entity=ImportedGroup::class,parentColumns=["id"],childColumns=["groupId"],onDelete=ForeignKey.CASCADE),
],indices=[Index("groupId"),Index("shotId")])
data class ImportedRow(val batchId:String,val sourceRecord:Int,val shotId:String,val groupId:String)

@Entity(tableName="imported_end_sources",foreignKeys=[
    ForeignKey(entity=JournalEnd::class,parentColumns=["id"],childColumns=["endId"],onDelete=ForeignKey.CASCADE),
    ForeignKey(entity=ImportBatch::class,parentColumns=["id"],childColumns=["batchId"],onDelete=ForeignKey.CASCADE),
],indices=[Index("batchId")])
data class ImportedEndSource(@PrimaryKey val endId:String,val batchId:String,val sourceKey:String,val rawNumber:String,val rawTimestamp:String,val localTime:String?)

@Dao
interface ImportDao {
    @Query("SELECT * FROM import_batches WHERE fileHash=:hash") suspend fun batch(hash:String):ImportBatch?
    @Query("SELECT * FROM import_batches WHERE id=:id") suspend fun batchById(id:String):ImportBatch?
    @Query("SELECT * FROM imported_groups") suspend fun groups():List<ImportedGroup>
    @Query("SELECT * FROM imported_groups WHERE importOperationId=:id") suspend fun operationGroups(id:String):List<ImportedGroup>
    @Query("SELECT * FROM imported_rows WHERE batchId=:id ORDER BY sourceRecord") suspend fun rows(id:String):List<ImportedRow>
    @Query("SELECT COUNT(*) FROM imported_groups WHERE batchId=:id") suspend fun batchGroupCount(id:String):Int
    @Query("SELECT * FROM imported_end_sources WHERE batchId=:id") suspend fun endSources(id:String):List<ImportedEndSource>
    @Insert suspend fun insert(value:ImportBatch)
    @Insert suspend fun insert(value:ImportedGroup)
    @Insert suspend fun insert(value:ImportedRow)
    @Insert suspend fun insert(value:ImportedEndSource)
}
