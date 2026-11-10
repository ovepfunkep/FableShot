package app.fableshot.android.backup

import android.content.Context
import android.database.Cursor
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import androidx.sqlite.db.SupportSQLiteDatabase
import app.fableshot.android.BuildConfig
import app.fableshot.android.data.EquipmentDatabase
import app.fableshot.android.data.UserPreferences
import app.fableshot.android.data.journal.JournalDatabase
import kotlinx.coroutines.*
import java.io.*
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.*

data class ExportedArchive(val file:File,val manifest:ArchiveManifest)
data class PreparedArchive(val directory:File,val manifest:ArchiveManifest,val preferences:Map<String,Pair<String,Any>>) {
    val journalFile get()=File(directory,"journal.db")
    val equipmentFile get()=File(directory,"equipment.db")
}

/** Every writable path here is a new UUID directory in private cache. Never replaces live files. */
class JournalArchive(
    private val context:Context,
    private val journal:JournalDatabase,
    private val equipment:EquipmentDatabase,
    private val preferences:UserPreferences,
    private val sourceFiles:File=context.filesDir,
    private val stagingRoot:File=File(context.cacheDir,"archive-staging"),
    private val limits:ArchiveLimits=ArchiveLimits(),
) {
    private fun workspace():File {stagingRoot.mkdirs();return File(stagingRoot,UUID.randomUUID().toString()).apply{check(mkdir())}}
    fun stagedFile(path:String):File=File(path).also { file->
        require(file.canonicalFile.parentFile?.parentFile==stagingRoot.canonicalFile&&file.isFile)
        require(runCatching{UUID.fromString(file.parentFile!!.name)}.isSuccess)
    }
    fun discard(file:File) {
        val folder=if(file.isDirectory)file else file.parentFile ?: return
        check(folder.canonicalFile.parentFile==stagingRoot.canonicalFile&&runCatching{UUID.fromString(folder.name)}.isSuccess)
        folder.deleteRecursively()
    }
    suspend fun export():ExportedArchive=withContext(Dispatchers.IO) {
        val folder=workspace();val file=File(folder,"FableShot.fableshot")
        // A coroutine context is captured instead of consulting it from non-suspending stream callbacks.
        val coroutine=currentCoroutineContext();val check={coroutine.ensureActive()}
        try {
            val payloads=mutableListOf<ArchivePayload>();val counts=linkedMapOf<String,Long>();val sources=mutableSetOf<String>()
            var total=0L
            FileOutputStream(file).use { disk->
                val zip=ZipOutputStream(BufferedOutputStream(disk))
                fun payload(path:String,body:(OutputStream)->Unit) {
                    check();zip.putNextEntry(ZipEntry(path));val digest=MessageDigest.getInstance("SHA-256");var size=0L
                    val output=object:OutputStream(){
                        override fun write(b:Int)=write(byteArrayOf(b.toByte()),0,1)
                        override fun write(b:ByteArray,off:Int,len:Int){check();if(len.toLong()>limits.maxUncompressedBytes-total)throw ArchiveInvalid("archive_too_large");zip.write(b,off,len);digest.update(b,off,len);size+=len;total+=len}
                    }
                    body(output);zip.closeEntry();payloads.add(ArchivePayload(path,size,digest.digest().hex()))
                    if(payloads.size+1>limits.maxEntries)throw ArchiveInvalid("too_many_entries")
                }
                suspend fun tables(db:RoomDatabase,names:List<String>,kind:String) = db.withTransaction {
                    for(table in names) {
                        val path="data/$kind/$table.jsonl";var rows=0L
                        payload(path){out->db.openHelper.writableDatabase.query("SELECT * FROM `$table`").use { cursor->
                            while(cursor.moveToNext()) {
                                check();val row=linkedMapOf<String,Any?>()
                                for(i in 0 until cursor.columnCount)row[cursor.getColumnName(i)]=when(cursor.getType(i)) {
                                    Cursor.FIELD_TYPE_NULL->null;Cursor.FIELD_TYPE_INTEGER->cursor.getLong(i);Cursor.FIELD_TYPE_FLOAT->cursor.getDouble(i);Cursor.FIELD_TYPE_STRING->cursor.getString(i);else->throw ArchiveInvalid("unsupported_sql_value")
                                }
                                val bytes=ArchiveJson.encode(row).toByteArray(Charsets.UTF_8)
                                if(bytes.size>MAX_LINE)throw ArchiveInvalid("row_too_large")
                                out.write(bytes);out.write(10);rows++
                                if(table=="import_batches")sources.add(row["rawSourcePath"] as String)
                            }
                        }};counts[path]=rows
                    }
                }
                try {
                    tables(journal,ArchiveEnvelopeVerifier.journalTables,"journal")
                    tables(equipment,ArchiveEnvelopeVerifier.equipmentTables,"equipment")
                    val preferenceBytes=ArchivePreferences.encode(preferences.archiveSnapshot())
                    payload("data/preferences.json"){it.write(preferenceBytes)}
                    for(path in sources.sorted()) {
                        val name=sourcePath(path);val source=File(sourceFiles,path)
                        if(source.canonicalFile.parentFile!=File(sourceFiles,"imports").canonicalFile||!source.isFile)throw ArchiveInvalid("missing_import_source")
                        payload(name){out->source.inputStream().use{input->copy(input,out,check)}}
                    }
                    val bytes=ArchiveManifestCodec.encode(System.currentTimeMillis(),BuildConfig.VERSION_NAME,counts,payloads)
                    if(bytes.size.toLong()>limits.maxUncompressedBytes-total)throw ArchiveInvalid("archive_too_large")
                    zip.putNextEntry(ZipEntry("manifest.json"));zip.write(bytes);zip.closeEntry();zip.finish();zip.flush();disk.fd.sync()
                } finally {zip.close()}
            }
            val manifest=manifest(file,check)
            file.inputStream().use{ArchiveEnvelopeVerifier.inspect(it,manifest.envelope,limits,check)}
            ExportedArchive(file,manifest)
        } catch(e:Exception){discard(folder);throw e}
    }
    suspend fun stage(input:InputStream):File=withContext(Dispatchers.IO) {
        val folder=workspace();val file=File(folder,"incoming.fableshot");val coroutine=currentCoroutineContext()
        try {input.use{source->FileOutputStream(file).use{out->var count=0L;val buffer=ByteArray(8192);while(true){coroutine.ensureActive();val n=source.read(buffer);if(n<0)break;count+=n;if(count>limits.maxUncompressedBytes+64L*1024*1024)throw ArchiveInvalid("archive_too_large");out.write(buffer,0,n)};out.fd.sync()}};file}
        catch(e:Exception){discard(folder);throw e}
    }
    suspend fun prepare(file:File):PreparedArchive=withContext(Dispatchers.IO) {
        require(file.canonicalFile.parentFile?.parentFile==stagingRoot.canonicalFile&&file.isFile)
        val folder=workspace();val coroutine=currentCoroutineContext();val check={coroutine.ensureActive()}
        var restoredJournal:JournalDatabase?=null;var restoredEquipment:EquipmentDatabase?=null
        try {
            val manifest=manifest(file,check)
            file.inputStream().use{ArchiveEnvelopeVerifier.inspect(it,manifest.envelope,limits,check)}
            restoredJournal=Room.databaseBuilder(context,JournalDatabase::class.java,File(folder,"journal.db").absolutePath).build()
            restoredEquipment=Room.databaseBuilder(context,EquipmentDatabase::class.java,File(folder,"equipment.db").absolutePath).build()
            val journalCopy=restoredJournal;val equipmentCopy=restoredEquipment
            ZipFile(file).use{zip->
                // ZipFile follows central-directory offsets, whereas the envelope scanner reads
                // local headers. Verify the bytes from this exact reader before decoding facts.
                for(payload in manifest.envelope.payloads) {
                    check();val entry=zip.getEntry(payload.path)?:throw ArchiveInvalid("missing_payload")
                    val digest=MessageDigest.getInstance("SHA-256");var size=0L
                    zip.getInputStream(entry).use{input->val buffer=ByteArray(8192);while(true){check();val n=input.read(buffer);if(n<0)break;if(n.toLong()>payload.bytes-size)throw ArchiveInvalid("payload_size_mismatch");digest.update(buffer,0,n);size+=n}}
                    if(size!=payload.bytes||digest.digest().hex()!=payload.sha256)throw ArchiveInvalid("payload_checksum_mismatch")
                }
                suspend fun restore(db:RoomDatabase,names:List<String>,kind:String)=db.withTransaction {
                    val sqlite=db.openHelper.writableDatabase
                    for(table in names) {
                        val path="data/$kind/$table.jsonl"
                        val columns=sqlite.query("PRAGMA table_info(`$table`)").use{cursor->buildList{while(cursor.moveToNext())add(Column(cursor.getString(1),cursor.getString(2),cursor.getInt(3)!=0,cursor.getInt(5)!=0))}}
                        val statement=sqlite.compileStatement("INSERT INTO `$table` (${columns.joinToString{ "`${it.name}`" }}) VALUES (${columns.joinToString{"?"}})")
                        var rows=0L
                        statement.use { stmt->zip.getInputStream(zip.getEntry(path)).use{input->lines(input,check){row->
                            if(rows>=manifest.rowCounts.getValue(path))throw ArchiveInvalid("row_count_mismatch")
                            val defaults=buildMap<String,Any?> {
                                if(kind=="journal"&&table=="session_plans") {
                                    if(manifest.envelope.journalSchema<7) put("roundCount",1L)
                                    if(manifest.envelope.journalSchema<11) put("rolling",0L)
                                    if(manifest.envelope.journalSchema<16) put("roundArrowLimit",null)
                                }
                                if(kind=="journal"&&table=="sessions"&&manifest.envelope.journalSchema<13&&"numberedArrows" !in row)
                                    put("numberedArrows",null)
                                if(kind=="journal"&&table=="ends"&&manifest.envelope.journalSchema<14)
                                    put("startsRound",0L)
                                if(kind=="journal"&&table=="shots"&&manifest.envelope.journalSchema<15)
                                    put("shaftDiameterMm",null)
                            }
                            row.exactKeys(columns.map{it.name}.toSet()-defaults.keys)
                            val restoredRow=row+defaults
                            restoredRow.exactKeys(columns.map{it.name}.toSet());stmt.clearBindings()
                            columns.forEachIndexed{i,c->bind(stmt,i+1,c,restoredRow[c.name])}
                            stmt.executeInsert();rows++
                        }}}
                        if(rows!=manifest.rowCounts[path])throw ArchiveInvalid("row_count_mismatch")
                    }
                }
                restore(journalCopy,ArchiveEnvelopeVerifier.journalTablesFor(manifest.envelope.journalSchema),"journal")
                restore(equipmentCopy,ArchiveEnvelopeVerifier.equipmentTables,"equipment")
                val prefs=zip.getInputStream(zip.getEntry("data/preferences.json")).use{ArchivePreferences.decode(bounded(it,1024*1024,check))}
                val expectedSources=mutableMapOf<String,String>()
                journalCopy.openHelper.writableDatabase.query("SELECT rawSourcePath,fileHash FROM import_batches").use{cursor->while(cursor.moveToNext()){val path=sourcePath(cursor.getString(0));val hash=cursor.getString(1);if(expectedSources.put(path,hash)!=null)throw ArchiveInvalid("duplicate_import_source")}}
                if(manifest.envelope.payloads.filter{it.path.startsWith("sources/")}.map{it.path}.toSet()!=expectedSources.keys)throw ArchiveInvalid("import_source_set_mismatch")
                for((path,hash)in expectedSources) {
                    check();val target=File(folder,"imports/${path.removePrefix("sources/")}");target.parentFile!!.mkdirs()
                    zip.getInputStream(zip.getEntry(path)).use{input->target.outputStream().use{copy(input,it,check)}}
                    // Verify the CSV itself, not just its compressed wrapper; bound nested decompression too.
                    val digest=MessageDigest.getInstance("SHA-256");var n=0L
                    GZIPInputStream(target.inputStream()).use{input->val buffer=ByteArray(8192);while(true){check();val read=input.read(buffer);if(read<0)break;n+=read;if(n>app.fableshot.android.importing.MyTargetsReader.MAX_BYTES)throw ArchiveInvalid("import_source_too_large");digest.update(buffer,0,read)}}
                    if(digest.digest().hex()!=hash)throw ArchiveInvalid("import_source_checksum_mismatch")
                }
                ArchiveFacts.validate(journalCopy.openHelper.writableDatabase,equipmentCopy.openHelper.writableDatabase,check)
                for(db in listOf(journalCopy,equipmentCopy))db.openHelper.writableDatabase.query("PRAGMA wal_checkpoint(TRUNCATE)").use{it.moveToFirst()}
                File(folder,"preferences.json").writeBytes(ArchivePreferences.encode(prefs))
                File(folder,"manifest.json").writeBytes(manifest.envelope.manifestBytes)
                PreparedArchive(folder,manifest,prefs)
            }
        } catch(e:Exception) {restoredJournal?.close();restoredJournal=null;restoredEquipment?.close();restoredEquipment=null;discard(folder);throw e}
        finally {restoredJournal?.close();restoredEquipment?.close()}
    }
    private fun manifest(file:File,check:()->Unit):ArchiveManifest=ZipFile(file).use{zip->
        val entry=zip.getEntry("manifest.json")?:throw ArchiveInvalid("missing_manifest")
        zip.getInputStream(entry).use{ArchiveManifestCodec.decode(bounded(it,limits.maxManifestBytes,check),limits)}
    }
    companion object {
        private const val MAX_LINE=8*1024*1024
        internal fun sourcePath(path:String):String {
            if(!Regex("imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.csv\\.gz").matches(path))throw ArchiveInvalid("invalid_import_source_path")
            return "sources/"+path.removePrefix("imports/")
        }
        private data class Column(val name:String,val type:String,val required:Boolean,val primary:Boolean)
        private fun bind(stmt:androidx.sqlite.db.SupportSQLiteStatement,index:Int,c:Column,value:Any?) {
            if(value==null){if(c.required||c.primary)throw ArchiveInvalid("missing_required_column");stmt.bindNull(index);return}
            when(c.type) {
                "TEXT"->stmt.bindString(index,value as? String?:throw ArchiveInvalid("invalid_text_column"))
                "INTEGER"->stmt.bindLong(index,value as? Long?:throw ArchiveInvalid("invalid_integer_column"))
                "REAL"->stmt.bindDouble(index,(value as? Number)?.toDouble()?.takeIf{it.isFinite()}?:throw ArchiveInvalid("invalid_real_column"))
                else->throw ArchiveInvalid("unsupported_column_type")
            }
        }
        private fun lines(input:InputStream,check:()->Unit,row:(Map<String,Any?>)->Unit) {
            val buffer=ByteArray(8192);val line=ByteArrayOutputStream()
            while(true){check();val n=input.read(buffer);if(n<0)break;for(i in 0 until n){val b=buffer[i];if(b==10.toByte()){if(line.size()==0)throw ArchiveInvalid("empty_jsonl_row");row(ArchiveJson.parse(ArchiveManifestCodec.utf8(line.toByteArray())).jsonObject());line.reset()}else{if(line.size()>=MAX_LINE)throw ArchiveInvalid("row_too_large");line.write(b.toInt())}}}
            if(line.size()!=0)throw ArchiveInvalid("unterminated_jsonl_row")
        }
        private fun bounded(input:InputStream,max:Int,check:()->Unit):ByteArray {val out=ByteArrayOutputStream();val buffer=ByteArray(8192);while(true){check();val n=input.read(buffer);if(n<0)break;if(n>max-out.size())throw ArchiveInvalid("entry_too_large");out.write(buffer,0,n)};return out.toByteArray()}
        private fun copy(input:InputStream,out:OutputStream,check:()->Unit){val buffer=ByteArray(8192);while(true){check();val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n)}}
        private fun ByteArray.hex()=joinToString(""){"%02x".format(it)}
    }
}
