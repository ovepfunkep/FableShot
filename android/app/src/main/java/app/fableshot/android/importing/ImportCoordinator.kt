package app.fableshot.android.importing

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.io.File
import java.io.InputStream
import java.nio.charset.CharacterCodingException

data class ImportUiState(val phase:String="empty",val file:File?=null,val sourceName:String?=null,val preview:MyTargetsPreview?=null,val inventory:ImportInventory=ImportInventory(emptySet(),emptySet()),val result:ImportResult?=null,val progress:Int=0,val errorCode:String?=null,val errorLine:Int?=null,val undoPlan:ImportUndoPlan?=null) {
    val busy get()=phase in setOf("copying","loading","importing","undoing")
}

/** Cancelling before commit rolls back; a late cancellation checks the receipt before reporting it. */
class ImportCoordinator(private val importer:MyTargetsImporter,private val scope:CoroutineScope) {
    private val mutable=MutableStateFlow(ImportUiState())
    val state=mutable.asStateFlow()
    private var job:Job?=null;private var generation=0
    private fun execute(base:ImportUiState,operation:String?=null,action:suspend(Int)->Unit) {
        job?.cancel();val token=++generation;mutable.value=base
        job=scope.launch {
            try{action(token)}
            catch(e:CancellationException){if(token==generation)withContext(NonCancellable){
                val completed=operation?.let{importer.resultForOperation(it)}
                val undone=operation?.let{importer.undoApplied(it)}==true
                mutable.value=if(undone)base.copy(phase="undone",undoPlan=null,errorCode=null)else if(completed!=null)base.copy(phase="done",result=completed,errorCode=null)else base.copy(phase=if(base.preview==null)"failed"else"ready",inventory=base.preview?.let{importer.inventory(it)}?:base.inventory,errorCode="cancelled")
            }}
            catch(e:Exception){if(token==generation)mutable.value=base.copy(phase=if(base.preview==null)"failed"else"ready",errorCode=when(e){is ImportRejected->e.code;is CsvFormatException->"invalid_csv";is CharacterCodingException->"invalid_utf8";is java.io.IOException->"io_error";else->"invalid_source"},errorLine=(e as?CsvFormatException)?.physicalLine)}
        }
    }
    private suspend fun loaded(file:File,name:String?,grouping:MyTargetsGrouping,token:Int) {
        val preview=importer.analyze(file,grouping);val inventory=importer.inventory(preview)
        if(token==generation)mutable.value=ImportUiState("ready",file,name,preview,inventory)
    }
    fun open(file:File,name:String?,grouping:MyTargetsGrouping=MyTargetsGrouping())=execute(ImportUiState("loading",file,name)){loaded(file,name,grouping,it)}
    fun pick(name:String?,open:()->InputStream)=execute(ImportUiState("copying",sourceName=name)){token->
        val file=withContext(Dispatchers.IO){importer.stage(open())}
        if(token==generation)mutable.value=ImportUiState("loading",file,name)
        loaded(file,name,MyTargetsGrouping(),token)
    }
    fun commit(choices:List<ImportChoice>,grouping:MyTargetsGrouping,operationId:String) {
        val previous=mutable.value;val file=previous.file?:return;val preview=previous.preview?:return
        execute(previous.copy(phase="importing",errorCode=null,progress=0),operationId){token->
            val result=importer.commit(file,preview.fileHash,choices,grouping,previous.sourceName,operationId){count->if(token==generation)mutable.update{it.copy(progress=count)}}
            if(token==generation)mutable.value=previous.copy(phase="done",result=result,errorCode=null)
        }
    }
    fun cancel(){job?.cancel()}
    fun reviewUndo(importOperation:String) {val base=mutable.value;execute(base.copy(phase="loading",errorCode=null)){token->val plan=importer.undoPlan(importOperation);if(token==generation)mutable.value=base.copy(phase="done",undoPlan=plan,errorCode=null)}}
    fun dismissUndo(){mutable.update{it.copy(undoPlan=null)}}
    fun undo(importOperation:String,plan:ImportUndoPlan,allowEdited:Boolean) {val base=mutable.value;val operation=java.util.UUID.randomUUID().toString();execute(base.copy(phase="undoing",undoPlan=null,errorCode=null),operation){token->importer.undo(importOperation,plan,allowEdited,operation);if(token==generation)mutable.value=base.copy(phase="undone",undoPlan=null,errorCode=null)}}
}
