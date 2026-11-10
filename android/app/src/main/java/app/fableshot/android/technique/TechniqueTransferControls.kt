package app.fableshot.android.technique

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.export.TechniquePdf
import app.fableshot.android.ui.FableIcon
import app.fableshot.android.ui.Glyph
import app.fableshot.android.ui.Text
import kotlinx.coroutines.*
import java.io.File
import java.util.UUID

@Composable
internal fun TechniqueImportButton(enabled: Boolean, onImport: (TechniqueText) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var preview by rememberSaveable { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true; error = null
            try {
                preview = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { TechniqueTransfer.read(it).json() }
                        ?: kotlin.error("Файл недоступен")
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message?.take(160) ?: "Не удалось прочитать памятку" }
            finally { busy = false }
        }
    }
    OutlinedButton({ picker.launch(arrayOf("application/json", "text/plain", "application/octet-stream")) },
        enabled = enabled && !busy, modifier = Modifier.testTag("technique-import")) {
        FableIcon(Glyph.Download); Spacer(Modifier.width(8.dp)); Text(if (busy) "Читаем…" else "Импорт памятки")
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    preview?.let { raw ->
        val text = remember(raw) { TechniqueText.parse(raw, true) }
        AlertDialog(onDismissRequest = { preview = null }, title = { Text("Импортировать памятку?") },
            text = { Text("${text.title}\n${text.phases.size} фаз · ${text.phases.sumOf { it.steps.size }} пунктов\n\nСоздадим отдельный черновик. Существующие памятки останутся.") },
            confirmButton = { TextButton({ preview = null; onImport(text) }, Modifier.testTag("technique-import-confirm"), enabled = enabled) { Text("Открыть черновик") } },
            dismissButton = { TextButton({ preview = null }) { Text("Отмена") } })
    }
}

@Composable
internal fun TechniqueExportButton(text: TechniqueText, versionLabel: String? = null, enabled: Boolean = true) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var pending by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingMime by rememberSaveable { mutableStateOf("application/pdf") }
    fun saved(uri: Uri?) {
        val file = pending?.let(::File)
        val mime = pendingMime
        pending = null
        if (uri == null || file == null) { file?.delete(); return }
        scope.launch {
            busy = true
            try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri, "w")?.use { out -> file.inputStream().use { it.copyTo(out) } }
                        ?: error("Файл недоступен")
                }
                message = "Памятка сохранена"
                try {
                    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    view.clipData = ClipData.newRawUri("Памятка", uri)
                    context.startActivity(view)
                } catch (_: ActivityNotFoundException) { message = "Памятка сохранена в выбранной папке" }
                catch (_: Exception) { message = "Памятка сохранена, но не удалось открыть просмотр" }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { message = "Не удалось сохранить файл. Выбери другую папку." }
            finally { busy = false; file.delete() }
        }
    }
    val pdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf"), ::saved)
    val json = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json"), ::saved)
    val plain = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain"), ::saved)
    fun export(format: String) {
        menu = false
        val snapshot = text
        scope.launch {
            busy = true; message = null
            try {
                val file = withContext(Dispatchers.IO) {
                    val directory = File(context.cacheDir, "reports").apply { mkdirs() }
                    if (format == "pdf") TechniquePdf.create(directory, snapshot, versionLabel,
                        context.resources.getFont(R.font.manrope_400), context.resources.getFont(R.font.manrope_700))
                    else File(directory, "technique-${UUID.randomUUID()}.$format").apply {
                        writeText(if (format == "json") snapshot.json() else TechniqueTransfer.plainText(snapshot), Charsets.UTF_8)
                    }
                }
                pending = file.absolutePath
                pendingMime = when (format) { "pdf" -> "application/pdf"; "json" -> "application/json"; else -> "text/plain" }
                when (format) {
                    "pdf" -> pdf.launch("FableShot-памятка.pdf")
                    "json" -> json.launch("FableShot-памятка.json")
                    else -> plain.launch("FableShot-памятка.txt")
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { message = "Не удалось подготовить памятку. Повтори экспорт." }
            finally { busy = false }
        }
    }
    IconButton({ menu = true }, enabled = enabled && !busy, modifier = Modifier.testTag("technique-export")) {
        FableIcon(Glyph.Share, description = "Экспорт памятки")
    }
    message?.let { Text(it, Modifier.testTag("technique-export-status"), style = MaterialTheme.typography.bodySmall) }
    if (menu) AlertDialog(onDismissRequest = { menu = false }, title = { Text("Экспорт памятки") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("PDF — для чтения и печати. JSON — для переноса с сохранением всех полей. Текст — для обычного редактора.")
            TextButton({ export("pdf") }, Modifier.testTag("technique-export-pdf")) { Text("PDF · полная расшифровка") }
            TextButton({ export("json") }, Modifier.testTag("technique-export-json")) { Text("JSON · редактируемая памятка") }
            TextButton({ export("txt") }, Modifier.testTag("technique-export-text")) { Text("Обычный текст") }
        } }, confirmButton = { TextButton({ menu = false }) { Text("Закрыть") } })
}
