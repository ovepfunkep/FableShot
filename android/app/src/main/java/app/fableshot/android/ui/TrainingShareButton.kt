package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import android.net.Uri
import android.util.Log
import android.widget.Toast
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.JournalDetails
import app.fableshot.android.export.PosterPalette
import app.fableshot.android.export.TrainingPoster
import app.fableshot.android.export.savePosterToDownloads
import app.fableshot.android.export.shareReportImages
import kotlinx.coroutines.*
import java.io.File

@Composable
fun TrainingShareButton(details:JournalDetails,settings:UserSettings,enabled:Boolean=true,onPrepared:((List<File>,List<Uri>)->Unit)?=null,onGenerated:suspend()->Unit={}) {
    val context=LocalContext.current
    val colors=MaterialTheme.colorScheme
    val visuals=LocalFableVisuals.current
    val palette=PosterPalette(colors.background.toArgb(),colors.surface.toArgb(),colors.onSurface.toArgb(),
        colors.onSurfaceVariant.toArgb(),colors.primary.toArgb(),colors.onPrimary.toArgb(),colors.outlineVariant.toArgb(),visuals.gold.toArgb())
    val scope=rememberCoroutineScope()
    var busy by remember {mutableStateOf(false)}
    var error by remember {mutableStateOf<String?>(null)}
    IconButton(onClick={scope.launch {
        busy=true
        var saved=emptyList<Uri>()
        var files=emptyList<File>()
        var prepared=false
        try {
            val job=currentCoroutineContext().job
            withContext(Dispatchers.Default) {
                files=TrainingPoster.create(context,details,settings.rankCategory,palette) {job.ensureActive()}
            }
            try {onGenerated()}
            catch(e:CancellationException) {throw e}
            catch(e:Exception) {Log.w("FablePoster","Could not record poster achievement",e)}
            try {saved=savePosterToDownloads(context,files)}
            catch(e:CancellationException) {throw e}
            catch(e:Exception) {
                Log.w("FablePoster","Could not save poster to Downloads",e)
                Toast.makeText(context,"Не удалось сохранить в Загрузки. Картинку можно отправить.",Toast.LENGTH_LONG).show()
            }
            if(onPrepared!=null)onPrepared(files,saved) else shareReportImages(context,files)
            prepared=true
            if(saved.isNotEmpty())Toast.makeText(context,"Сохранено в Загрузки / FableShot",Toast.LENGTH_SHORT).show()
        } catch(e:CancellationException) {throw e}
        catch(e:Exception) {
            Log.w("FablePoster","Could not prepare or share poster",e)
            error=when {
                saved.isNotEmpty() -> "Меню отправки не открылось. Картинка сохранена в Загрузки / FableShot."
                files.isNotEmpty() -> "Не удалось открыть меню отправки. Попробуй ещё раз."
                else -> "Не удалось подготовить картинку. Попробуй ещё раз."
            }
        } finally {
            if(!prepared)files.forEach {it.delete()}
            busy=false
        }
    }},enabled=enabled&&!busy&&details.blocks.any {it.ends.any {entry -> entry.volume>0}},modifier=Modifier.testTag("training-share")) {
        if(busy)CircularProgressIndicator(strokeWidth=androidx.compose.ui.unit.Dp(2f))
        else FableIcon(Glyph.Share,description="Поделиться тренировкой")
    }
    error?.let {message -> AlertDialog(onDismissRequest={error=null},title={Text("Картинка тренировки")},
        text={Text(message)},confirmButton={TextButton({error=null}) {Text("Понятно")}})}
}
