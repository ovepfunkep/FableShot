package app.fableshot.android.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import org.json.JSONObject
import java.util.UUID

@Entity(tableName="equipment_items",indices=[Index("kind")])
data class EquipmentItem(
    @PrimaryKey val id:String=UUID.randomUUID().toString(),
    val kind:String,
    val name:String,
    val category:String?=null,
    val model:String?=null,
    val notes:String?=null,
    val drawWeightLb:Double?=null,
    val drawLengthIn:Double?=null,
    val spine:Int?=null,
    val lengthMm:Double?=null,
    val massGrain:Double?=null,
    val diameterMm:Double?=null,
    val numberedCount:Int?=null,
    val bowId:String?=null,
    val arrowsId:String?=null,
    val favorite:Boolean=false,
    val archived:Boolean=false,
    val revision:Long=0,
    val createdAtMs:Long=0,
    val updatedAtMs:Long=0,
)

@Entity(tableName="equipment_revisions",primaryKeys=["itemId","revision"])
data class EquipmentRevision(val itemId:String,val revision:Long,val snapshotJson:String,val changedAtMs:Long)

@Dao
interface EquipmentDao {
    @Query("SELECT * FROM equipment_items ORDER BY favorite DESC,updatedAtMs DESC") fun observe():Flow<List<EquipmentItem>>
    @Query("SELECT * FROM equipment_items") suspend fun all():List<EquipmentItem>
    @Query("SELECT * FROM equipment_items WHERE id=:id") suspend fun item(id:String):EquipmentItem?
    @Query("SELECT * FROM equipment_revisions WHERE itemId=:id ORDER BY revision DESC") suspend fun revisions(id:String):List<EquipmentRevision>
    @Upsert suspend fun put(value:EquipmentItem)
    @Insert suspend fun insert(value:EquipmentRevision)
    @Query("DELETE FROM equipment_revisions WHERE itemId=:id AND revision=1 AND EXISTS (SELECT 1 FROM equipment_items WHERE id=:id AND revision=1)")
    suspend fun removeImportedRevision(id:String)
    @Query("DELETE FROM equipment_items WHERE id=:id AND revision=1")
    suspend fun removeUneditedImportedItem(id:String)
}

@Database(entities=[EquipmentItem::class,EquipmentRevision::class],version=1,exportSchema=true)
abstract class EquipmentDatabase:RoomDatabase(){abstract fun equipmentDao():EquipmentDao}

/** Separate local catalog, referenced by immutable values rather than cross-database foreign keys. */
class EquipmentRepository(private val db:EquipmentDatabase,private val gate:WriteGate=WriteGate(),private val now:()->Long=System::currentTimeMillis) {
    val items=db.equipmentDao().observe()
    private val dao=db.equipmentDao()
    suspend fun revisions(id:String)=dao.revisions(id)
    suspend fun save(value:EquipmentItem):EquipmentItem=gate.write { db.withTransaction {
        val old=dao.item(value.id)
        require((old?.revision?:0)==value.revision){"EQUIPMENT_REVISION_CONFLICT"}
        require(old==null||old.kind==value.kind)
        require(value.kind in setOf("bow","arrows","setup")&&value.name.trim().isNotEmpty()&&value.name.length<=100)
        require(value.category==null||value.kind=="bow"&&value.category in BOW_CATEGORIES)
        require(listOf(value.drawWeightLb,value.drawLengthIn,value.lengthMm,value.massGrain,value.diameterMm).all{it==null||it.isFinite()&&it>0})
        require(value.diameterMm==null||app.fableshot.android.domain.ArrowShaft.validDiameter(value.diameterMm))
        require(value.spine==null||value.spine>0);require(value.numberedCount==null||value.numberedCount in 1..1000)
        require(value.kind=="setup"||value.bowId==null&&value.arrowsId==null)
        if(value.bowId!=null)require(dao.item(value.bowId)?.let{it.kind=="bow"&&!it.archived}==true)
        if(value.arrowsId!=null)require(dao.item(value.arrowsId)?.let{it.kind=="arrows"&&!it.archived}==true)
        val instant=now()
        if(value.favorite&&!value.archived)dao.all().filter{it.kind==value.kind&&it.favorite&&it.id!=value.id}.forEach{dao.persistRevision(it.copy(favorite=false,revision=it.revision+1,updatedAtMs=instant),instant)}
        val saved=value.copy(name=value.name.trim(),model=value.model?.trim()?.takeIf{it.isNotEmpty()},notes=value.notes?.trim()?.takeIf{it.isNotEmpty()},favorite=value.favorite&&!value.archived,
            revision=(old?.revision?:0)+1,createdAtMs=old?.createdAtMs?:instant,updatedAtMs=instant)
        dao.persistRevision(saved,instant);saved
    }
    }
    suspend fun snapshot(id:String):String=db.withTransaction {
        val all=dao.all();val item=requireNotNull(all.firstOrNull{it.id==id})
        require(item in selectableEquipment(all)) {"Archived equipment cannot be selected"}
        equipmentSnapshot(item,all)
    }
    companion object {val BOW_CATEGORIES=setOf("barebow","recurve","compound","traditional","longbow","other")}
}

internal suspend fun EquipmentDao.persistRevision(item: EquipmentItem, instant: Long) {
    put(item)
    insert(EquipmentRevision(item.id, item.revision, item.json().toString(), instant))
}

fun selectableEquipment(items:List<EquipmentItem>)=items.filter{item->!item.archived&&listOfNotNull(item.bowId,item.arrowsId).all{id->items.any{it.id==id&&!it.archived}}}

fun isSetupSnapshot(raw: String?): Boolean = raw?.let {
    runCatching { JSONObject(it).optJSONObject("selection")?.optString("kind") == "setup" }.getOrDefault(false)
} ?: false

private fun EquipmentItem.json()=JSONObject().apply {
    put("id",id);put("revision",revision);put("kind",kind);put("name",name)
    listOf("category" to category,"model" to model,"notes" to notes,"drawWeightLb" to drawWeightLb,"drawLengthIn" to drawLengthIn,"spine" to spine,"lengthMm" to lengthMm,"massGrain" to massGrain,"diameterMm" to diameterMm,"numberedCount" to numberedCount,"bowId" to bowId,"arrowsId" to arrowsId).forEach{(key,value)->put(key,value?:JSONObject.NULL)}
}
fun equipmentSnapshot(item:EquipmentItem,items:List<EquipmentItem>):String {
    require(item in selectableEquipment(items))
    return JSONObject().apply {
        put("schema",1);put("selection",item.json())
        val bow=if(item.kind=="bow")item else items.firstOrNull{it.id==item.bowId}
        val arrows=if(item.kind=="arrows")item else items.firstOrNull{it.id==item.arrowsId}
        put("bow",bow?.json()?:JSONObject.NULL);put("arrows",arrows?.json()?:JSONObject.NULL)
    }.toString()
}
