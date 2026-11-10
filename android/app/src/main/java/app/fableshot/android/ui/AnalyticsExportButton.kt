package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog
import android.content.*
import android.provider.DocumentsContract
import android.net.Uri
import app.fableshot.android.export.ReportImages
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.core.content.FileProvider
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.export.AnalyticsPdf
import app.fableshot.android.export.AnalyticsCsv
import androidx.compose.foundation.layout.Column
import kotlinx.coroutines.*
import java.io.File

@Composable fun AnalyticsExportButton(selected:List<SessionSummary>,period:String,valid:Boolean,loadDetails:(suspend (String)->app.fableshot.android.data.SessionDetails?)?=null) {
 val context=LocalContext.current;val scope=rememberCoroutineScope()
 var menu by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf<String?>(null)}
 var format by rememberSaveable{mutableStateOf("pdf")}
 var pendingImages by rememberSaveable{mutableStateOf(arrayListOf<String>())}
 var pendingMime by rememberSaveable{mutableStateOf("application/pdf")}
 var pending by rememberSaveable{mutableStateOf<String?>(null)}
 fun openSaved(uri:Uri,mime:String,label:String){
  try{val view=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);view.clipData=ClipData.newRawUri("Отчёт",uri);context.startActivity(view)}catch(_:ActivityNotFoundException){message="$label сохранён. На телефоне нет приложения для просмотра этого формата."}catch(_:Exception){message="$label сохранён, но не удалось открыть просмотр."}
 }
 val saveImages=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()){tree->
  val paths=pendingImages.toList();pendingImages=arrayListOf()
  if(tree!=null&&paths.isNotEmpty())scope.launch{busy=true;var count=0;var first:Uri?=null;try{
   withContext(Dispatchers.IO){val batch=java.util.UUID.randomUUID().toString();val parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));paths.forEachIndexed{index,path->
    val name="FableShot-$batch-страница-${(index+1).toString().padStart(4,'0')}.png"
    val uri=DocumentsContract.createDocument(context.contentResolver,parent,"image/png",name)?:error("Create image failed")
    context.contentResolver.openOutputStream(uri,"w")!!.use{out->File(path).inputStream().use{it.copyTo(out)}};if(first==null)first=uri;count++
   }};message="Сохранено страниц: $count";first?.let{openSaved(it,"image/png","Изображения")}
  }catch(e:CancellationException){throw e}catch(_:Exception){message="Сохранено страниц: $count из ${paths.size}. Не удалось завершить сохранение."}finally{busy=false}}
 }
 val onSaved:(android.net.Uri?)->Unit={uri->
  val source=pending;val mime=pendingMime;val label=if(mime=="text/csv")"CSV"else "PDF";pending=null
  if(uri!=null&&source!=null)scope.launch{busy=true;try{withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri,"w")!!.use{out->File(source).inputStream().use{it.copyTo(out)}}};message="$label сохранён"
   try {
    val view=Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    view.clipData=ClipData.newRawUri("Отчёт",uri)
    context.startActivity(view)
   }catch(_:ActivityNotFoundException){message="$label сохранён. На телефоне нет приложения для просмотра этого формата."}
    catch(_:Exception){message="$label сохранён, но не удалось открыть просмотр. Файл доступен в выбранной папке."}
  }catch(e:CancellationException){throw e}catch(_:Exception){message="Не удалось сохранить файл. Попробуй другое место."}finally{busy=false}}
 }
 val savePdf=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf"),onSaved)
 val saveCsv=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv"),onSaved)
 fun export(share:Boolean){
  menu=false;if(busy)return
  val snapshot=selected.toList();val caption=period;val asCsv=format=="csv";val asImages=format=="images";val mime=if(asCsv)"text/csv"else "application/pdf"
  scope.launch{busy=true;message=null;try{
   if(asImages){
    val files=withContext(Dispatchers.IO){val pdf=AnalyticsPdf.create(File(context.cacheDir,"reports"),snapshot,caption,context.resources.getFont(app.fableshot.android.R.font.manrope_400),context.resources.getFont(app.fableshot.android.R.font.manrope_700));try{val current=currentCoroutineContext();ReportImages.create(pdf,File(context.cacheDir,"reports")){current.ensureActive()}}finally{pdf.delete()}}
    if(share){app.fableshot.android.export.shareReportImages(context,files,"Отправить страницы отчёта")}
    else{pendingImages=ArrayList(files.map{it.absolutePath});saveImages.launch(null)}
    return@launch
   }
   val file=withContext(Dispatchers.IO){if(asCsv){
    val details=snapshot.map{row->val d=loadDetails?.invoke(row.id)?.journal?:error("Missing session");check(d.session.state=="completed"&&d.session.deletedAtMs==null&&(row.journalMeta==null||d.session.revision==row.journalMeta.sessionRevision));d}
    AnalyticsCsv.create(File(context.cacheDir,"reports"),details)
   }else AnalyticsPdf.create(File(context.cacheDir,"reports"),snapshot,caption,context.resources.getFont(app.fableshot.android.R.font.manrope_400),context.resources.getFont(app.fableshot.android.R.font.manrope_700))}
   if(share){val uri=FileProvider.getUriForFile(context,context.packageName+".reports",file);val send=Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);send.clipData=ClipData.newRawUri("Отчёт",uri);context.startActivity(Intent.createChooser(send,"Отправить отчёт"))}
   else{pending=file.absolutePath;pendingMime=mime;if(asCsv)saveCsv.launch("FableShot-попадания.csv")else savePdf.launch("FableShot-отчёт.pdf")}
  }catch(e:CancellationException){throw e}catch(_:Exception){message="Не удалось подготовить отчёт. Обнови выборку и повтори экспорт."}finally{busy=false}}
 }
 IconButton({menu=true},enabled=valid&&selected.isNotEmpty()&&!busy,modifier=Modifier.testTag("analytics-export")){FableIcon(Glyph.Download,description=if(busy)"Подготовка отчёта"else "Экспорт отчёта")}
 message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
 if(menu)AlertDialog(onDismissRequest={menu=false},title={Text("Отчёт по выборке")},text={Column {
 Text("Выбрано занятий: ${selected.size}. Экспортируются все условия выбранных занятий.")
 FilterChip(format=="pdf",{format="pdf"},{Text("PDF · отчёт")})
 FilterChip(format=="csv",{format="csv"},{Text("CSV · все попадания")},enabled=loadDetails!=null)
 FilterChip(format=="images",{format="images"},{Text("PNG · страницы отчёта")})
 if(format=="images")HelpButton("О PNG", "Каждая страница — отдельное изображение. Для сохранения выбери папку; после записи откроется первая страница.")
 if(format=="csv")HelpButton("О CSV", "CSV FableShot: все раунды и условия, разминка и зачёт. Счётчик отдельной строкой, неизвестные поля пустые. Координаты с исходным статусом достоверности. UTF-8, разделитель ;. Текст, похожий на формулу Excel, защищён апострофом.")
 }},confirmButton={TextButton({export(true)},Modifier.testTag("export-share")){Text("Поделиться")}},dismissButton={TextButton({export(false)},Modifier.testTag("export-save")){Text("Сохранить")}})
}
