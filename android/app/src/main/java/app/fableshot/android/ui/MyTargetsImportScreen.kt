package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.platform.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.*
import app.fableshot.android.importing.*
import java.io.File
import java.io.IOException
import java.util.UUID

@Composable
fun MyTargetsImportScreen(importer:MyTargetsImporter,equipment:List<EquipmentItem>,onHistory:()->Unit,initialFile:File?=null,onTrash:()->Unit=onHistory) {
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    val coordinator=remember(importer){ImportCoordinator(importer,scope)}
    val ui by coordinator.state.collectAsState()
    var stagePath by rememberSaveable{mutableStateOf(initialFile?.absolutePath)}
    // Only user overrides are saved; a large untouched CSV never puts all its arrows into a Bundle.
    var fields by rememberSaveable{mutableStateOf(hashMapOf<String,String>())}
    var splits by rememberSaveable{mutableStateOf(arrayListOf<Int>())}
    var joins by rememberSaveable{mutableStateOf(arrayListOf<Int>())}
    var operation by rememberSaveable{mutableStateOf(UUID.randomUUID().toString())}
    var operationKey by rememberSaveable{mutableStateOf("")}
    var search by rememberSaveable { mutableStateOf("") }
    var problemsOnly by rememberSaveable { mutableStateOf(false) }
    var confirmBoundaries by rememberSaveable { mutableStateOf(false) }
    var allowEditedUndo by remember(ui.undoPlan){mutableStateOf(false)}
    fun set(key:String,value:String){fields=HashMap(fields).apply{put(key,value)}}
    fun grouping()=MyTargetsGrouping(splits.toSet(),joins.toSet())
    LaunchedEffect(Unit){stagePath?.let{coordinator.open(File(it),null,grouping())}}
    LaunchedEffect(ui.file?.absolutePath){ui.file?.let{stagePath=it.absolutePath}}
    BackHandler(ui.busy){coordinator.cancel()}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null){fields=hashMapOf();splits=arrayListOf();joins=arrayListOf();stagePath=null;coordinator.pick(null){context.contentResolver.openInputStream(uri)?:throw IOException("Source unavailable")}}}
    val preview=ui.preview
    val already=remember(ui.inventory.alreadyRecords){java.util.TreeSet(ui.inventory.alreadyRecords)}
    fun imported(end:MyTargetsEnd)=already.ceiling(end.firstRecord)?.let{it<=end.lastRecord}==true
    fun bad(group:MyTargetsGroup,end:MyTargetsEnd)=group.issues.any{it.blocking&&it.record in end.firstRecord..end.lastRecord}
    fun selected(group:MyTargetsGroup,end:MyTargetsEnd):Boolean {
        if(imported(end)||bad(group,end))return false
        return (fields["end:${end.key}"]?:fields["group:${group.key}"])?.let{it=="1"}?:!ui.inventory.possibleEndFingerprints.contains(end.fingerprint)
    }
    fun mapping(block:MyTargetsBlock):ImportBlockMapping {
        val prefix="block:${block.key}:"
        fun value(key:String,fallback:String)=fields[prefix+key]?:fallback
        val raw=suggestedMapping(block)
        val distance=value("distance",raw.distanceMeters?.toString().orEmpty()).replace(',','.').toDoubleOrNull()
        val diameter=value("diameter",raw.diameterMm?.let{(it/10.0).toString()}.orEmpty()).replace(',','.').toDoubleOrNull()?.times(10)?.takeIf{it.isFinite()&&it%1==0.0&&it<=100000}?.toInt()
        val plan=value("plan",raw.arrowsPerEnd.toString()).toIntOrNull()?:0
        val item=selectableEquipment(equipment).firstOrNull{it.id==fields[prefix+"equipment"]}
        val snapshot=item?.let{equipmentSnapshot(it,equipment)}?:raw.equipmentSnapshotJson
        val bow=if(item?.kind=="bow")item else equipment.firstOrNull{it.id==item?.bowId}
        val category=bow?.category?:if(fields.containsKey(prefix+"category"))fields[prefix+"category"]?.takeIf{it.isNotBlank()}else raw.bowCategory
        return ImportBlockMapping(block.key,distance,diameter,plan,value("scale",if(raw.scaleConfirmed)"1"else"0")=="1",snapshot,category)
    }
    fun validInputs(block:MyTargetsBlock):Boolean {
        val raw=suggestedMapping(block);val prefix="block:${block.key}:"
        val distance=fields[prefix+"distance"]?:raw.distanceMeters?.toString().orEmpty()
        val diameter=fields[prefix+"diameter"]?:raw.diameterMm?.let{(it/10.0).toString()}.orEmpty()
        val parsed=mapping(block)
        return (distance.isBlank()||parsed.distanceMeters?.let{it.isFinite()&&it>0}==true)&&(diameter.isBlank()||parsed.diameterMm?.let{it>0}==true)
    }
    val choices=preview?.groups.orEmpty().mapNotNull{group->
        val ends=group.blocks.flatMap{it.ends}.filter{selected(group,it)}
        if(ends.isEmpty())null else ImportChoice(group.key,ends.map{it.key}.toSet(),group.blocks.filter{b->b.ends.any{it in ends}}.map{mapping(it)},fields["boundary:${group.key}"]=="1",fields["duplicates:${group.key}"]=="1")
    }
    val selectedCount=preview?.groups.orEmpty().sumOf{g->g.blocks.flatMap{it.ends}.filter{selected(g,it)}.sumOf{it.shotCount}}
    val valid=choices.isNotEmpty()&&choices.all{choice->
        val group=preview!!.groups.single{it.key==choice.groupKey}
        (!group.ambiguousBoundary||choice.acceptAmbiguousBoundary)&&
        (choice.allowPossibleDuplicate||group.blocks.flatMap{it.ends}.filter{it.key in choice.endKeys}.none{it.fingerprint in ui.inventory.possibleEndFingerprints})&&
        choice.mappings.all{m->val block=group.blocks.single{it.key==m.key};validInputs(block)&&m.scaleConfirmed&&m.arrowsPerEnd in 1..12&&m.distanceMeters?.let{it.isFinite()&&it>0}!=false&&m.diameterMm?.let{it>0}!=false&&block.ends.filter{it.key in choice.endKeys}.all{it.shotCount<=m.arrowsPerEnd}}
    }
    fun reasons(group:MyTargetsGroup):List<String> {
        val choice=choices.firstOrNull { it.groupKey==group.key } ?: return emptyList()
        return buildList {
            if(group.ambiguousBoundary && !choice.acceptAmbiguousBoundary) add("Подтвердите границу тренировки")
            if(!choice.allowPossibleDuplicate && group.blocks.flatMap { it.ends }.any { it.key in choice.endKeys && it.fingerprint in ui.inventory.possibleEndFingerprints }) add("Проверьте возможные дубликаты")
            if(choice.mappings.any { !it.scaleConfirmed }) add("Подтвердите исходные условия")
            if(choice.mappings.any { m -> val block=group.blocks.single { it.key==m.key }; !validInputs(block) || m.arrowsPerEnd !in 1..12 || block.ends.any { it.key in choice.endKeys && it.shotCount>m.arrowsPerEnd } }) add("Исправьте дистанцию, размер или число стрел в серии")
        }
    }
    val blockedGroups=preview?.groups.orEmpty().filter { reasons(it).isNotEmpty() }
    Column(Modifier.fillMaxSize().testTag("mytargets-import")) {
        if(ui.result!=null) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp).testTag("import-result"),verticalArrangement=Arrangement.spacedBy(20.dp)) {
                FableIcon(Glyph.Check,Modifier.size(48.dp),tint=MaterialTheme.colorScheme.primary)
                Text(stringResource(if(ui.phase=="undone")R.string.import_undo_complete else R.string.import_complete),style=MaterialTheme.typography.headlineLarge)
                Text(if(ui.phase=="undone")stringResource(R.string.import_undo_hint)else stringResource(R.string.import_result_count,ui.result?.sessionIds?.size?:0,ui.result?.shotCount?:0),style=MaterialTheme.typography.bodyLarge)
                Text(stringResource(R.string.import_coordinates_unverified),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if(ui.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
                if(ui.errorCode!=null)InfoCard(importErrorLabel(ui.errorCode!!),stringResource(R.string.import_error_hint))
                FablePrimaryButton(stringResource(R.string.history),onHistory,Modifier.fillMaxWidth().testTag("import-go-history"),enabled=!ui.busy)
                if(ui.phase!="undone")TextButton({coordinator.reviewUndo(operation)},Modifier.testTag("import-undo"),enabled=!ui.busy){Text(stringResource(R.string.import_undo))}
            }
        } else {
            LazyColumn(Modifier.weight(1f).testTag("import-preview-list"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
                item{Text("MyTargets",style=MaterialTheme.typography.headlineLarge);Spacer(Modifier.height(8.dp));HelpButton(stringResource(R.string.help_about),stringResource(R.string.import_local_hint))}
                item{FablePrimaryButton("Выбрать архив ZIP или CSV",{picker.launch(arrayOf("application/zip","application/x-zip-compressed","text/*","application/csv","application/octet-stream"))},Modifier.fillMaxWidth().testTag("import-pick-file"),enabled=!ui.busy)}
                item{Text("Архив MyTargets ZIP сохраняет точные границы тренировок и настройки серий. CSV остаётся дополнительным способом: его границы иногда требуют подтверждения.",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
                if(ui.errorCode!=null)item{InfoCard(importErrorLabel(ui.errorCode!!),ui.errorLine?.let{stringResource(R.string.import_line,it)}?:stringResource(R.string.import_error_hint))}
                if(ui.busy)item{FableCard{LinearProgressIndicator(Modifier.fillMaxWidth());Text(stringResource(if(ui.phase=="importing")R.string.import_saving else R.string.import_analyzing));if(ui.progress>0)Text(stringResource(R.string.import_progress,ui.progress));TextButton(coordinator::cancel,Modifier.testTag("import-cancel")){Text(stringResource(R.string.cancel))}}}
                if(preview!=null){
                    item {
                        FableCard {
                            Text("${preview.groups.size} тренировок · ${preview.groups.sumOf { it.endCount }} серий · ${preview.groups.sumOf { it.shotCount }} стрел",style=MaterialTheme.typography.titleMedium)
                            Text("Выбрано: ${choices.size} тренировок · $selectedCount стрел")
                            if(preview.sourceFormat=="zip") {
                                Text("ZIP MyTargets · границы тренировок взяты из архива",style=MaterialTheme.typography.bodySmall)
                                if(preview.skippedEmptySlots>0)Text("Незаполненных мест для стрел: ${preview.skippedEmptySlots}. Они не считаются промахами и не переносятся.",style=MaterialTheme.typography.bodySmall)
                                Text("Фотографий в архиве: ${preview.ignoredAttachments}. Фотографии и исходные заметки остаются в сохранённом файле источника; в карточки дневника они пока не переносятся.",style=MaterialTheme.typography.bodySmall)
                            }
                            if(blockedGroups.isNotEmpty()) Text("Требуют внимания: ${blockedGroups.size}",color=MaterialTheme.colorScheme.error)
                            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                TextButton({ fields=HashMap(fields.filterKeys { !it.startsWith("end:") }).apply { preview.groups.forEach { put("group:${it.key}","1") } } },enabled=!ui.busy) { Text("Выбрать все новые") }
                                TextButton({ fields=HashMap(fields.filterKeys { !it.startsWith("end:") }).apply { preview.groups.forEach { put("group:${it.key}","0") } } },enabled=!ui.busy) { Text("Снять выбор") }
                            }
                            HelpButton("Как подтвердить условия","Сверьте дистанции, размеры мишеней и число стрел с исходным дневником. Кнопка ниже подтверждает эти условия для выбранных тренировок. Координаты остаются непроверенными; спортивная точность их переноса не подтверждается этой кнопкой. Спорные границы и дубликаты проверяются отдельно.")
                            TextButton({ fields=HashMap(fields).apply { choices.flatMap { it.mappings }.forEach { put("block:${it.key}:scale","1") } } },enabled=!ui.busy&&choices.isNotEmpty()) { Text("Подтвердить исходные условия выбранных") }
                            if(preview.sourceFormat=="csv"&&choices.any { choice -> preview.groups.any { it.key==choice.groupKey&&it.ambiguousBoundary } })
                                TextButton({confirmBoundaries=true},Modifier.testTag("import-review-boundaries"),enabled=!ui.busy) { Text("Проверить границы выбранных тренировок") }
                            OutlinedTextField(search,{search=it},Modifier.fillMaxWidth(),label={Text("Поиск по названию или дате")},singleLine=true)
                            FilterChip(problemsOnly,{problemsOnly=!problemsOnly},{Text("Только требующие внимания")})
                        }
                    }
                    if(ui.inventory.trashedSessionIds.isNotEmpty())item{FableCard{Text(stringResource(R.string.import_in_trash));TextButton(onTrash){Text(stringResource(R.string.trash_title))}}}
                    preview.groups.forEachIndexed{groupIndex,group->
                        val groupReasons=reasons(group)
                        if(problemsOnly&&groupReasons.isEmpty()) return@forEachIndexed
                        if(search.isNotBlank()&&!group.title.contains(search,true)&&!group.rawDate.contains(search,true)) return@forEachIndexed
                        item(key="group-${group.key}"){
                            val ends=group.blocks.flatMap{it.ends};val picked=ends.count{selected(group,it)}
                            FableCard {
                                Row(verticalAlignment=Alignment.CenterVertically){Checkbox(picked==ends.size,{set("group:${group.key}",if(it)"1"else"0")},enabled=!ui.busy);Column(Modifier.weight(1f)){Text(group.title.ifBlank{"MyTargets"},style=MaterialTheme.typography.titleLarge);Text(group.date?.toString()?:stringResource(R.string.import_date_unknown),color=MaterialTheme.colorScheme.onSurfaceVariant)}}
                                Text(stringResource(R.string.import_group_summary,group.endCount,group.shotCount,group.points),style=MaterialTheme.typography.bodyMedium)
                                groupReasons.forEach { Text(it,color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodySmall) }
                                TextButton({set("details:${group.key}",if(fields["details:${group.key}"]=="1")"0"else"1")}) { Text(if(fields["details:${group.key}"]=="1")"Скрыть серии и условия"else"Серии и условия") }
                                if(group.ambiguousBoundary){
                                    Row(verticalAlignment=Alignment.CenterVertically){Checkbox(fields["boundary:${group.key}"]=="1",{set("boundary:${group.key}",if(it)"1"else"0")},enabled=!ui.busy);Text(stringResource(R.string.import_boundary_confirm),Modifier.weight(1f))}
                                    if(groupIndex>0)TextButton({joins=ArrayList(joins+group.firstRecord);fields=hashMapOf();coordinator.open(requireNotNull(ui.file),ui.sourceName,grouping())},enabled=!ui.busy){Text(stringResource(R.string.import_merge_previous))}
                                }
                                if(ends.any{it.fingerprint in ui.inventory.possibleEndFingerprints})Row(verticalAlignment=Alignment.CenterVertically){Checkbox(fields["duplicates:${group.key}"]=="1",{set("duplicates:${group.key}",if(it)"1"else"0")},enabled=!ui.busy);Text(stringResource(R.string.import_duplicate_confirm),Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)}
                                group.issues.filter{it.code!="unverified_coordinate_axes"}.take(8).forEach{issue->Text(if(preview.sourceFormat=="zip")importIssueLabel(issue.code)else stringResource(R.string.import_issue_line,issue.line,importIssueLabel(issue.code)),style=MaterialTheme.typography.bodySmall,color=if(issue.blocking)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)}
                            }
                        }
                        if(fields["details:${group.key}"]=="1") group.blocks.forEach{block->
                            item(key="mapping-${block.key}"){
                                val prefix="block:${block.key}:";val suggested=suggestedMappings(group).single{it.key==block.key}
                                FableCard {
                                    Text(block.conditions.target,style=MaterialTheme.typography.titleMedium)
                                    Text(listOf(block.conditions.distance,block.conditions.bow,block.conditions.arrows).filter{it.isNotBlank()}.joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                                    OutlinedTextField(fields[prefix+"distance"]?:suggested.distanceMeters?.toString().orEmpty(),{set(prefix+"distance",it.take(12))},Modifier.fillMaxWidth(),label={Text(stringResource(R.string.distance_meters))},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),enabled=!ui.busy)
                                    OutlinedTextField(fields[prefix+"diameter"]?:suggested.diameterMm?.let{(it/10.0).toString()}.orEmpty(),{set(prefix+"diameter",it.take(8))},Modifier.fillMaxWidth(),label={Text(stringResource(R.string.custom_diameter))},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),enabled=!ui.busy)
                                    OutlinedTextField(fields[prefix+"plan"]?:suggested.arrowsPerEnd.toString(),{set(prefix+"plan",it.take(2))},Modifier.fillMaxWidth().testTag("import-plan-${block.key}"),label={Text(stringResource(R.string.custom_arrows))},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),enabled=!ui.busy)
                                    Row(verticalAlignment=Alignment.CenterVertically){Checkbox(mapping(block).scaleConfirmed,{set(prefix+"scale",if(it)"1"else"0")},enabled=!ui.busy);Text(stringResource(R.string.import_scale_confirm),Modifier.weight(1f),style=MaterialTheme.typography.bodySmall)}
                                    EquipmentChoice(stringResource(R.string.nav_equipment),selectableEquipment(equipment),fields[prefix+"equipment"],{set(prefix+"equipment",it.orEmpty())},enabled=!ui.busy)
                                    HelpButton(stringResource(R.string.help_about),stringResource(R.string.import_category_hint))
                                    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){FilterChip(mapping(block).bowCategory==null,{set(prefix+"category","")},{Text(stringResource(R.string.equipment_unspecified))},enabled=!ui.busy);EquipmentRepository.BOW_CATEGORIES.forEach{category->FilterChip(mapping(block).bowCategory==category,{set(prefix+"category",category)},{Text(bowCategoryLabel(category))},enabled=!ui.busy)}}
                                }
                            }
                            items(block.ends,key={it.key}){end->
                                Row(Modifier.fillMaxWidth().heightIn(min=64.dp),verticalAlignment=Alignment.CenterVertically) {
                                    Checkbox(selected(group,end),{set("end:${end.key}",if(it)"1"else"0")},Modifier.testTag("import-end-${end.key}"),enabled=!ui.busy&&!imported(end)&&!bad(group,end))
                                    Column(Modifier.weight(1f)){Text(stringResource(R.string.import_end_summary,end.number,end.shotCount,end.points),style=MaterialTheme.typography.bodyMedium);if(imported(end))Text(stringResource(R.string.import_already),style=MaterialTheme.typography.bodySmall);else if(end.fingerprint in ui.inventory.possibleEndFingerprints)Text(stringResource(R.string.import_possible_duplicate),style=MaterialTheme.typography.bodySmall)}
                                    if(preview.sourceFormat=="csv"&&end.firstRecord!=group.firstRecord)TextButton({splits=ArrayList(splits+end.firstRecord);fields=hashMapOf();coordinator.open(requireNotNull(ui.file),ui.sourceName,grouping())},enabled=!ui.busy){Text(stringResource(R.string.import_split))}
                                }
                            }
                        }
                    }
                }
            }
            if(preview!=null)Surface(color=MaterialTheme.colorScheme.surface){Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                if(!valid&&!ui.busy) Text(
                    if(choices.isEmpty()) "Выберите новые серии. Уже перенесённые записи не добавляются повторно."
                    else blockedGroups.flatMap { reasons(it) }.distinct().joinToString(" · "),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
                FablePrimaryButton(stringResource(R.string.import_selected,selectedCount),{
                    val key=preview.fileHash+fields.toSortedMap().toString()+splits.sorted()+joins.sorted()
                    if(key!=operationKey){operation=UUID.randomUUID().toString();operationKey=key}
                    coordinator.commit(choices,grouping(),operation)
                },Modifier.fillMaxWidth().testTag("import-confirm"),enabled=!ui.busy&&valid)
            }}
        }
    }
    if(confirmBoundaries&&preview!=null)AlertDialog(
        onDismissRequest={confirmBoundaries=false},
        title={Text("Границы тренировок из CSV")},
        text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
            val count=choices.count { choice -> preview.groups.any { it.key==choice.groupKey&&it.ambiguousBoundary } }
            Text("Спорных границ среди выбранных: $count. CSV не содержит ID тренировок. Новое занятие предложено там, где при одинаковых названии и дате снова начинается нумерация серий или раундов.")
            Text("Если каждое такое начало действительно было отдельной тренировкой, можно подтвердить их вместе. Если это части одного занятия, откройте его карточку и объедините с предыдущей. Архив ZIP содержит точные ID и снимает эту неопределённость.")
        }},
        confirmButton={TextButton({
            fields=HashMap(fields).apply { choices.forEach { choice ->
                if(preview.groups.any { it.key==choice.groupKey&&it.ambiguousBoundary })put("boundary:${choice.groupKey}","1")
            } }
            confirmBoundaries=false
        },Modifier.testTag("import-accept-boundaries")){Text("Это отдельные тренировки")}},
        dismissButton={TextButton({confirmBoundaries=false}){Text("Проверить по одной")}},
    )
    ui.undoPlan?.let{plan->AlertDialog(onDismissRequest=coordinator::dismissUndo,title={Text(stringResource(R.string.import_undo))},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){Text(stringResource(R.string.import_undo_hint));if(plan.items.any{it.edited}){Text(stringResource(R.string.import_undo_edited));Row(verticalAlignment=Alignment.CenterVertically){Checkbox(allowEditedUndo,{allowEditedUndo=it},Modifier.testTag("import-undo-allow-edits"));Text(stringResource(R.string.import_undo_allow_edits),Modifier.weight(1f))}}}},confirmButton={TextButton({coordinator.undo(operation,plan,allowEditedUndo)},Modifier.testTag("import-undo-confirm"),enabled=!ui.busy&&(!plan.items.any{it.edited}||allowEditedUndo)){Text(stringResource(R.string.trash_action))}},dismissButton={TextButton(coordinator::dismissUndo){Text(stringResource(R.string.cancel))}})}
}

@Composable
private fun importErrorLabel(code:String):String {
    if(code.startsWith("archive_"))return when(code) {
        "archive_schema_unsupported"->"Эта версия архива MyTargets пока не поддерживается. Можно использовать экспорт CSV."
        "archive_unsafe_path","archive_duplicate_entry","archive_unsupported_entry"->"В ZIP обнаружен неожиданный или небезопасный состав. Выберите исходную резервную копию MyTargets."
        "archive_too_large","archive_too_many_entries","archive_too_many_rows"->"Архив превышает допустимый размер или число записей."
        else->"Не удалось проверить архив MyTargets: файл повреждён или его данные несогласованы."
    }
    return stringResource(when(code){"cancelled"->R.string.import_cancelled;"already_imported_records"->R.string.import_already;"possible_duplicate"->R.string.import_possible_duplicate;"source_changed"->R.string.import_source_changed;else->R.string.import_failed})
}
@Composable
private fun importIssueLabel(code:String):String {
    if(code=="unsupported_archive_target")return "Для этой мишени или системы очков ещё нет проверенного преобразования. Серия не выбрана для импорта."
    if(code=="invalid_archive_score")return "В серии найден неизвестный номер зоны очков. Оценка не заменена промахом; проверьте исходную запись в MyTargets."
    if(code=="archive_series_totals_mismatch"||code=="invalid_archive_series")return "Число стрел или сумма серии не совпадают с данными архива. Серия требует проверки в MyTargets."
    return stringResource(when(code){"ambiguous_session_boundary"->R.string.import_boundary_hint;"unknown_date"->R.string.import_date_unknown;"unknown_distance_unit","unknown_target_size"->R.string.unknown_conditions;"invalid_coordinate_pair"->R.string.import_invalid_coordinates;else->R.string.import_invalid_row})
}

