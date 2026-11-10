package app.fableshot.android.technique

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.fableshot.android.ui.*
import app.fableshot.android.ui.Text
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The list is an outline; only the currently edited item owns text fields. */
@Composable
internal fun CompactTechniqueEditor(document: TechniqueDocument, repo: TechniqueRepository, onBack: () -> Unit) {
    val saver = remember { Saver<TechniqueText, String>(save = { it.json() }, restore = { TechniqueText.parse(it, true) }) }
    var text by rememberSaveable(document.id, stateSaver = saver) { mutableStateOf(TechniqueText.parse(document.draftJson, true)) }
    var expected by rememberSaveable(document.id) { mutableStateOf(document.draftJson) }
    var status by remember { mutableStateOf("Черновик сохраняется автоматически") }
    var busy by remember { mutableStateOf(false) }
    var metadata by rememberSaveable { mutableStateOf(false) }
    var editingStep by rememberSaveable { mutableStateOf<String?>(null) }
    var editingStepPhase by rememberSaveable { mutableStateOf<String?>(null) }
    var editingPhase by rememberSaveable { mutableStateOf<String?>(null) }
    var paste by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val writes = remember(document.id) { Mutex() }
    val raw = text.json()
    suspend fun saveDraft(snapshot: String) = writes.withLock {
        if (snapshot != expected) {
            withContext(NonCancellable) {
                repo.draft(document.id, expected, snapshot)
                expected = snapshot
            }
        }
    }
    LaunchedEffect(raw, busy) {
        if (busy || raw == expected) return@LaunchedEffect
        status = "Сохраняем черновик…"
        delay(500)
        try { saveDraft(raw); status = "Черновик сохранён" }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { status = "Черновик не сохранён. Повтори сохранение; при конфликте переоткрой памятку." }
    }
    fun close() {
        if (busy) return
        val snapshot = text.json()
        busy = true
        scope.launch {
            try { saveDraft(snapshot); onBack() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { status = "Не удалось сохранить черновик. Текст остаётся в редакторе." }
            finally { busy = false }
        }
    }
    BackHandler { close() }
    fun updatePhase(value: TechniquePhase) { text = text.copy(phases = text.phases.map { if (it.id == value.id) value else it }) }
    Column(Modifier.fillMaxSize().testTag("technique-editor")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(::close, enabled = !busy, modifier = Modifier.testTag("technique-editor-close")) {
                FableIcon(Glyph.Back, description = "Сохранить черновик и выйти")
            }
            Text("Моя памятка", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            TechniqueExportButton(text, "Черновик", enabled = !busy)
        }
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(text.title, { text = text.copy(title = it.take(100)) },
                Modifier.fillMaxWidth().testTag("technique-title"), label = { Text("Название") }, enabled = !busy, singleLine = true)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TextButton({ metadata = !metadata }, enabled = !busy) { Text("${if (metadata) "Скрыть" else "Добавить"} описание") }
                Spacer(Modifier.weight(1f))
                IconButton({ paste = true }, enabled = !busy, modifier = Modifier.testTag("technique-paste")) {
                    FableIcon(Glyph.Notes, description = "Вставить алгоритм текстом")
                }
            }
            if (metadata) {
                OutlinedTextField(text.context, { text = text.copy(context = it.take(200)) }, Modifier.fillMaxWidth(), label = { Text("Лук или контекст") }, enabled = !busy)
                OutlinedTextField(text.description, { text = text.copy(description = it.take(4000)) }, Modifier.fillMaxWidth(), label = { Text("Описание памятки") }, enabled = !busy)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(text.discussed != null, { text = text.copy(discussed = if (it) java.time.LocalDate.now().toString() else null) }, enabled = !busy)
                    Text("Обсуждал с тренером сегодня", Modifier.weight(1f))
                }
                OutlinedTextField(text.change, { text = text.copy(change = it.take(1000)) }, Modifier.fillMaxWidth(), label = { Text("Изменения версии") }, enabled = !busy)
            }
            text.phases.forEachIndexed { index, phase ->
                FableCard {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("${index + 1}. ${phase.title.ifBlank { "Фаза" }}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                        IconButton({ editingPhase = phase.id }, enabled = !busy) { FableIcon(Glyph.Edit, description = "Изменить фазу ${index + 1}") }
                    }
                    phase.steps.forEachIndexed { stepIndex, step ->
                        Surface(Modifier.fillMaxWidth().clickable(enabled = !busy) { editingStepPhase = phase.id; editingStep = step.id }
                            .testTag("technique-step-${phase.id}-${step.id}"), shape = MaterialTheme.shapes.medium,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f)) {
                            Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("${stepIndex + 1}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Column(Modifier.weight(1f)) {
                                    Text(step.short.ifBlank { step.detail.lineSequence().firstOrNull().orEmpty().ifBlank { "Новый пункт" } }, maxLines = 2)
                                    if (step.question.isNotBlank()) Text("Уточнить с тренером", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                                }
                                FableIcon(Glyph.Edit, Modifier.size(18.dp))
                            }
                        }
                    }
                    TextButton({
                        val next = TechniqueStep()
                        updatePhase(phase.copy(steps = phase.steps + next)); editingStepPhase = phase.id; editingStep = next.id
                    }, enabled = !busy && phase.steps.size < 50, modifier = Modifier.testTag("technique-add-step-$index")) {
                        FableIcon(Glyph.Plus, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Добавить пункт")
                    }
                }
            }
            OutlinedButton({
                val next = TechniquePhase(title = "Новая фаза")
                text = text.copy(phases = text.phases + next); editingPhase = next.id
            }, enabled = !busy && text.phases.size < 30) { Text("Добавить фазу") }
            Spacer(Modifier.height(8.dp))
        }
        Text(status, Modifier.fillMaxWidth().testTag("technique-save-status"), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        FablePrimaryButton(if (busy) "Сохраняем…" else "Сохранить версию", {
            val snapshot = text.json()
            busy = true
            scope.launch {
                try {
                    writes.withLock { repo.publish(document.id, expected, snapshot) }
                    onBack()
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { status = "Не удалось сохранить версию. Текст остаётся в черновике; проверь название и повтори." }
                finally { busy = false }
            }
        }, Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("technique-publish"), enabled = !busy && text.title.isNotBlank())
    }
    val phase = text.phases.firstOrNull { it.id == editingPhase }
    if (phase != null) PhaseEditor(phase, text.phases.indexOf(phase), text.phases.lastIndex,
        onDismiss = { editingPhase = null }, onChange = ::updatePhase,
        onMove = { delta ->
            val phases = text.phases.toMutableList()
            val index = phases.indexOfFirst { it.id == phase.id }
            java.util.Collections.swap(phases, index, index + delta); text = text.copy(phases = phases)
        }, onDelete = { text = text.copy(phases = text.phases.filter { it.id != phase.id }); editingPhase = null })
    val owner = text.phases.firstOrNull { it.id == editingStepPhase }
    val step = owner?.steps?.firstOrNull { it.id == editingStep }
    if (owner != null && step != null) StepEditor(step, owner.steps.indexOf(step), owner.steps.lastIndex,
        onDismiss = { editingStep = null }, onChange = { value -> updatePhase(owner.copy(steps = owner.steps.map { if (it.id == value.id) value else it })) },
        onMove = { delta ->
            val steps = owner.steps.toMutableList(); val index = steps.indexOfFirst { it.id == step.id }
            java.util.Collections.swap(steps, index, index + delta); updatePhase(owner.copy(steps = steps))
        }, onDelete = { updatePhase(owner.copy(steps = owner.steps.filter { it.id != step.id })); editingStep = null })
    if (paste) TechniquePasteDialog(onDismiss = { paste = false }, onAppend = { imported ->
        val nonEmpty = text.phases.filter { it.steps.isNotEmpty() }
        val updated = text.copy(phases = nonEmpty + imported.phases)
        TechniqueText.parse(updated.json(), true)
        text = updated; paste = false
    })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StepEditor(step: TechniqueStep, index: Int, last: Int, onDismiss: () -> Unit,
    onChange: (TechniqueStep) -> Unit, onMove: (Int) -> Unit, onDelete: () -> Unit) {
    var expanded by rememberSaveable(step.id) { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Пункт ${index + 1}", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(step.short, { onChange(step.copy(short = it.take(200))) }, Modifier.fillMaxWidth().testTag("technique-step-short"), label = { Text("Короткая подсказка") })
            OutlinedTextField(step.detail, { onChange(step.copy(detail = it.take(4000))) }, Modifier.fillMaxWidth().testTag("technique-step-detail"), minLines = 3, label = { Text("Полное пояснение") })
            TextButton({ expanded = !expanded }) { Text(if (expanded) "Скрыть подробности" else "Подпункты и тренер") }
            if (expanded) {
                OutlinedTextField(step.children, { onChange(step.copy(children = it.take(4000))) }, Modifier.fillMaxWidth().testTag("technique-step-children"), label = { Text("Подпункты · каждый с новой строки") })
                OutlinedTextField(step.question, { onChange(step.copy(question = it.take(1000))) }, Modifier.fillMaxWidth().testTag("technique-step-question"), label = { Text("Уточнить с тренером") })
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(step.visible, { onChange(step.copy(visible = it)) }); Text("Показывать в кратком режиме", Modifier.weight(1f))
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                IconButton({ onMove(-1) }, enabled = index > 0) { Text("↑") }
                IconButton({ onMove(1) }, enabled = index < last) { Text("↓") }
                IconButton({ confirmDelete = true }) { FableIcon(Glyph.Trash, description = "Удалить пункт") }
            }
            FablePrimaryButton("Готово", onDismiss, Modifier.fillMaxWidth().testTag("technique-step-done"))
            Spacer(Modifier.height(16.dp))
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("Удалить пункт?") },
        confirmButton = { TextButton({ confirmDelete = false; onDelete() }) { Text("Удалить") } },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("Отмена") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PhaseEditor(phase: TechniquePhase, index: Int, last: Int, onDismiss: () -> Unit,
    onChange: (TechniquePhase) -> Unit, onMove: (Int) -> Unit, onDelete: () -> Unit) {
    var confirmDelete by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().imePadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(phase.title, { onChange(phase.copy(title = it.take(100))) }, Modifier.fillMaxWidth(), label = { Text("Название фазы") })
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                IconButton({ onMove(-1) }, enabled = index > 0) { Text("↑") }
                IconButton({ onMove(1) }, enabled = index < last) { Text("↓") }
                IconButton({ confirmDelete = true }) { FableIcon(Glyph.Trash, description = "Удалить фазу") }
            }
            FablePrimaryButton("Готово", onDismiss, Modifier.fillMaxWidth())
            Spacer(Modifier.height(20.dp))
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("Удалить фазу и её пункты?") },
        confirmButton = { TextButton({ confirmDelete = false; onDelete() }) { Text("Удалить") } },
        dismissButton = { TextButton({ confirmDelete = false }) { Text("Отмена") } })
}

@Composable
private fun TechniquePasteDialog(onDismiss: () -> Unit, onAppend: (TechniqueText) -> Unit) {
    var raw by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Вставить алгоритм") },
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Вставь текст целиком. Пункты разделяй пустой строкой или нумерацией. Для фаз можно написать ## Название. Добавим к памятке, не заменяя прежние пункты.")
            OutlinedTextField(raw, { raw = it.take(TechniqueTransfer.MAX_TEXT_CHARS) }, Modifier.fillMaxWidth().heightIn(min = 180.dp).testTag("technique-paste-text"), minLines = 5, label = { Text("Текст алгоритма") })
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        } }, confirmButton = { TextButton({
            try { onAppend(TechniqueTransfer.fromText(raw)) }
            catch (failure: Exception) { error = failure.message ?: "Не удалось добавить текст. Раздели его на несколько частей." }
        }, Modifier.testTag("technique-paste-apply"), enabled = raw.isNotBlank()) { Text("Добавить пункты") } },
        dismissButton = { TextButton(onDismiss) { Text("Отмена") } })
}
