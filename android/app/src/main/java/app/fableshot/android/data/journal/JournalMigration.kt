package app.fableshot.android.data.journal

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.util.UUID

internal const val PRACTICE_PROFILE="practice-full-10-v1"
internal fun practiceSnapshot(diameter:Int):String {
    val zones=(10 downTo 1).joinToString(","){"{\"code\":\"$it\",\"points\":$it,\"outerRadius\":${(11-it)/10.0},\"isX\":false}"}
    return "{\"snapshotVersion\":1,\"profileId\":\"$PRACTICE_PROFILE\",\"profileVersion\":1,\"geometryType\":\"circle\",\"scoringRuleVersion\":\"practice-point-10-v1\",\"boundaryRule\":\"greater-score\",\"boundaryEpsilon\":1e-9,\"diameterMm\":$diameter,\"faces\":[{\"faceId\":\"main\",\"zones\":[$zones]}]}"
}
internal fun migratedBlockId(sessionId:String)=UUID.nameUUIDFromBytes("fableshot:block:v2:$sessionId".toByteArray(Charsets.UTF_8)).toString()

/** Keep source tables under legacy names; create final FK targets directly, inside one transaction. */
val MIGRATION_1_2:Migration=object:Migration(1,2){
    override fun migrate(db:SupportSQLiteDatabase) {
        require(count(db,"SELECT COUNT(*) FROM sessions WHERE profileId<>'$PRACTICE_PROFILE' OR distanceMeters<=0 OR targetDiameterMm<=0 OR arrowsPerEnd NOT BETWEEN 1 AND 12 OR state NOT IN ('active','completed')")==0L){"Unsupported legacy session"}
        require(count(db,"SELECT COUNT(*) FROM shots WHERE points NOT BETWEEN 0 AND 10 OR (x IS NULL)!=(y IS NULL) OR origin NOT IN ('numeric','target','manual') OR revision<1")==0L){"Invalid legacy shot"}
        require(count(db,"SELECT COUNT(*) FROM ends WHERE number<1 OR plannedCount NOT BETWEEN 1 AND 12")==0L){"Invalid legacy end"}
        require(count(db,"SELECT COUNT(*) FROM (SELECT e.id FROM ends e LEFT JOIN shots s ON s.endId=e.id GROUP BY e.id HAVING COUNT(s.id)>e.plannedCount)")==0L){"Overfilled legacy end"}
        require(count(db,"SELECT COUNT(*) FROM sessions WHERE state='active'")<=1){"Multiple legacy active sessions"}
        db.query("PRAGMA foreign_key_check").use{require(!it.moveToFirst()){ "Broken legacy relationship" }}
        db.query("SELECT endId,MIN(inputIndex),MAX(inputIndex),COUNT(*) FROM shots GROUP BY endId").use{c->while(c.moveToNext())require(c.getInt(1)==0&&c.getInt(2)==c.getInt(3)-1){"Invalid legacy order"}}
        // Rename the source graph first. Fresh final tables then have stable FK names,
        // independent of OEM legacy_alter_table / foreign_keys rename behaviour.
        for(table in listOf("shots","ends","sessions"))db.execSQL("ALTER TABLE $table RENAME TO ${table}_legacy")
        createGraph(db)
        db.execSQL("INSERT INTO sessions SELECT id,title,startedAt,startedAt,completedAt,NULL,NULL,'legacy_app_clock',state,'training','native',1,NULL FROM sessions_legacy")
        db.query("SELECT id,distanceMeters,targetDiameterMm,arrowsPerEnd FROM sessions_legacy").use{c->while(c.moveToNext()){
            val id=c.getString(0);val distance=c.getDouble(1);val diameter=c.getInt(2)
            require(distance.isFinite()){ "Invalid legacy distance" }
            db.execSQL("INSERT INTO blocks VALUES(?,?,0,'scored',?,?,1,?,?,NULL,?,1)",arrayOf<Any?>(migratedBlockId(id),id,distance,PRACTICE_PROFILE,diameter,practiceSnapshot(diameter),c.getInt(3)))
        }}
        db.query("SELECT id,sessionId,number,plannedCount,closed FROM ends_legacy").use{c->while(c.moveToNext())db.execSQL("INSERT INTO ends VALUES(?,?,?,?, 'scored',?,NULL,NULL,1)",arrayOf<Any?>(c.getString(0),migratedBlockId(c.getString(1)),c.getInt(2)-1,c.getInt(3),if(c.getInt(4)==1)"closed"else"open"))}
        db.query("SELECT id,endId,inputIndex,points,x,y,origin,createdAt,revision FROM shots_legacy").use{c->while(c.moveToNext()){
            val known=!c.isNull(4);val x=if(known)c.getDouble(4)else null;val y=if(known)c.getDouble(5)else null
            require(!known||(x!!.isFinite()&&y!!.isFinite())){"Invalid legacy coordinates"}
            val scoreSource=when(c.getString(6)){"target"->"target_computed";"manual"->"manual_edit";else->"numeric_entry"}
            db.execSQL("INSERT INTO shots VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,?, ?,NULL,?,NULL,?)",arrayOf<Any?>(c.getString(0),c.getString(1),c.getInt(2),c.getInt(3),if(c.getInt(3)==0)"M"else c.getInt(3).toString(),x,y,if(known)"main"else null,scoreSource,if(known)"manual_target"else"none",if(known)"known"else"unknown",c.getLong(7),c.getLong(8)))
        }}
        for(table in listOf("sessions","ends","shots"))require(count(db,"SELECT COUNT(*) FROM ${table}_legacy")==count(db,"SELECT COUNT(*) FROM $table")){"Migration row count mismatch"}
        require(count(db,"SELECT COALESCE(SUM(points),0) FROM shots_legacy")==count(db,"SELECT COALESCE(SUM(points),0) FROM shots")){"Migration score mismatch"}
        for(table in listOf("shots","ends","sessions"))db.execSQL("DROP TABLE ${table}_legacy")
        db.execSQL("CREATE INDEX index_sessions_state_deletedAtMs ON sessions(state,deletedAtMs)")
        db.execSQL("CREATE UNIQUE INDEX index_blocks_sessionId_ordinal ON blocks(sessionId,ordinal)")
        db.execSQL("CREATE UNIQUE INDEX index_ends_blockId_ordinal ON ends(blockId,ordinal)")
        db.execSQL("CREATE UNIQUE INDEX index_shots_endId_inputIndex ON shots(endId,inputIndex)")
        db.execSQL("CREATE INDEX index_mutation_receipts_sessionId ON mutation_receipts(sessionId)")
        db.query("PRAGMA foreign_key_check").use{require(!it.moveToFirst()){ "Broken migrated relationship" }}
    }
}
private fun count(db:SupportSQLiteDatabase,sql:String)=db.query(sql).use{it.moveToFirst();it.getLong(0)}
private fun createGraph(db:SupportSQLiteDatabase) {
    db.execSQL("CREATE TABLE sessions (id TEXT NOT NULL PRIMARY KEY,title TEXT NOT NULL,createdAtMs INTEGER NOT NULL,startedAtMs INTEGER,completedAtMs INTEGER,localDate TEXT,timeZoneId TEXT,timeSource TEXT NOT NULL,state TEXT NOT NULL,kind TEXT NOT NULL,sourceKind TEXT NOT NULL,revision INTEGER NOT NULL,deletedAtMs INTEGER)")
    db.execSQL("CREATE TABLE blocks (id TEXT NOT NULL PRIMARY KEY,sessionId TEXT NOT NULL,ordinal INTEGER NOT NULL,mode TEXT NOT NULL,distanceMeters REAL,targetProfileId TEXT,targetProfileVersion INTEGER,targetDiameterMm INTEGER,targetSnapshotJson TEXT,equipmentSnapshotJson TEXT,defaultArrowsPerEnd INTEGER NOT NULL,revision INTEGER NOT NULL,FOREIGN KEY(sessionId) REFERENCES sessions(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
    db.execSQL("CREATE TABLE ends (id TEXT NOT NULL PRIMARY KEY,blockId TEXT NOT NULL,ordinal INTEGER NOT NULL,plannedCount INTEGER NOT NULL,role TEXT NOT NULL,state TEXT NOT NULL,createdAtMs INTEGER,closedAtMs INTEGER,revision INTEGER NOT NULL,FOREIGN KEY(blockId) REFERENCES blocks(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
    db.execSQL("CREATE TABLE shots (id TEXT NOT NULL PRIMARY KEY,endId TEXT NOT NULL,inputIndex INTEGER NOT NULL,points INTEGER NOT NULL,zoneCode TEXT,automaticPoints INTEGER,automaticRuleVersion TEXT,x REAL,y REAL,faceId TEXT,scoreSource TEXT NOT NULL,positionSource TEXT NOT NULL,positionStatus TEXT NOT NULL,physicalArrowNumber INTEGER,createdAtMs INTEGER NOT NULL,updatedAtMs INTEGER,revision INTEGER NOT NULL,FOREIGN KEY(endId) REFERENCES ends(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
    db.execSQL("CREATE TABLE unscored_counts (endId TEXT NOT NULL PRIMARY KEY,count INTEGER NOT NULL,createdAtMs INTEGER NOT NULL,updatedAtMs INTEGER NOT NULL,revision INTEGER NOT NULL,FOREIGN KEY(endId) REFERENCES ends(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
    db.execSQL("CREATE TABLE mutation_receipts (operationId TEXT NOT NULL PRIMARY KEY,sessionId TEXT NOT NULL,kind TEXT NOT NULL,payloadHash TEXT NOT NULL,resultId TEXT NOT NULL,resultRevision INTEGER NOT NULL,appliedAtMs INTEGER NOT NULL)")
}
