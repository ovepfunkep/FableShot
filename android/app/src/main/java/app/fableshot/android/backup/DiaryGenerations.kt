package app.fableshot.android.backup

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

data class DiarySelection(val current:String="legacy",val previous:String?=null)

/** The atomic pointer is the sole commit boundary. Old generations are retained, never overwritten. */
class DiaryGenerations(private val root:File,private val checkpoint:(String)->Unit={}) {
    private val pointer=File(root,"selection.json")
    fun read():DiarySelection {
        if(!pointer.exists())return DiarySelection()
        if(pointer.length()>4096)throw ArchiveInvalid("invalid_diary_selection")
        val json=ArchiveJson.parse(ArchiveManifestCodec.utf8(pointer.readBytes())).jsonObject()
        json.exactKeys(setOf("version","current","previous"))
        if(json.long("version")!=1L)throw ArchiveInvalid("unsupported_diary_selection")
        val previous=json["previous"]?.let{it as? String?:throw ArchiveInvalid("invalid_diary_selection")}
        return DiarySelection(json.string("current"),previous).also {validateId(it.current);it.previous?.let(::validateId);if(it.current==it.previous)throw ArchiveInvalid("invalid_diary_selection")}
    }
    fun folder(id:String):File {validateId(id);require(id!="legacy");return File(root,id)}
    fun newFolder():File {root.mkdirs();return folder(UUID.randomUUID().toString()).apply{check(mkdir())}}
    fun seal(directory:File) {
        require(directory.canonicalFile.parentFile==root.canonicalFile);validateId(directory.name)
        for(name in listOf("journal.db","equipment.db","preferences.preferences_pb"))if(!File(directory,name).isFile)throw ArchiveInvalid("incomplete_diary_generation")
        atomicWrite(File(directory,"ready.json"),ArchiveJson.encode(mapOf("version" to 1,"id" to directory.name)).toByteArray())
        checkpoint("generation_ready")
    }
    fun validate(id:String) {
        if(id=="legacy")return
        val directory=folder(id)
        val ready=File(directory,"ready.json")
        if(!ready.isFile||ready.length()>4096)throw ArchiveInvalid("incomplete_diary_generation")
        val json=ArchiveJson.parse(ArchiveManifestCodec.utf8(ready.readBytes())).jsonObject()
        json.exactKeys(setOf("version","id"))
        if(json.long("version")!=1L||json.string("id")!=id)throw ArchiveInvalid("incomplete_diary_generation")
        for(name in listOf("journal.db","equipment.db","preferences.preferences_pb"))if(!File(directory,name).isFile)throw ArchiveInvalid("incomplete_diary_generation")
    }
    fun activate(id:String,expected:DiarySelection):DiarySelection {
        validate(id);check(read()==expected){"DIARY_SELECTION_CHANGED"};check(id!=expected.current)
        val selection=DiarySelection(id,expected.current)
        val bytes=ArchiveJson.encode(mapOf("version" to 1,"current" to id,"previous" to expected.current)).toByteArray()
        try {
            checkpoint("before_selection")
            atomicWrite(pointer,bytes)
            checkpoint("after_selection")
        }catch(e:Exception) {
            // A failure after rename must not report the old selection or reactivate stale writers.
            if(read()!=selection)throw e
        }
        return selection
    }
    private fun validateId(id:String){if(id!="legacy"&&(runCatching{UUID.fromString(id).toString()}.getOrNull()!=id))throw ArchiveInvalid("invalid_diary_generation_id")}
    companion object {
        fun syncFile(file:File){FileOutputStream(file,true).use{it.fd.sync()}}
        fun syncDirectory(directory:File){require(directory.isDirectory);val fd=Os.open(directory.absolutePath,OsConstants.O_RDONLY,0);try{Os.fsync(fd)}finally{Os.close(fd)}}
        private fun atomicWrite(file:File,bytes:ByteArray) {
            file.parentFile!!.mkdirs();val temporary=File(file.parentFile,".${UUID.randomUUID()}.tmp")
            try {
                FileOutputStream(temporary).use{it.write(bytes);it.fd.sync()}
                Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
                syncDirectory(file.parentFile!!)
            }finally{temporary.delete()}
        }
    }
}
