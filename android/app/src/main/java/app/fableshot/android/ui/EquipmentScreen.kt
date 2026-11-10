package app.fableshot.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.data.*

@Composable
fun EquipmentScreen(items:List<EquipmentItem>,busy:Boolean,error:Boolean,
    onArrowAnalysis: ((String) -> Unit)? = null,onSave:(EquipmentItem,()->Unit)->Unit) {
    var kind by rememberSaveable{mutableStateOf("bow")}
    var archived by rememberSaveable{mutableStateOf(false)}
    var editing by remember{mutableStateOf<EquipmentItem?>(null)}
    val draft=editing
    BackHandler(draft!=null){editing=null}
    if(draft!=null){EquipmentEditor(draft,items,busy,error,{editing=null},onSaveComponent=onSave){value->onSave(value){editing=null}};return}
    LazyColumn(Modifier.fillMaxSize().testTag("equipment-screen"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        item{Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){equipmentKinds.forEach{(id,label)->FilterChip(kind==id,{kind=id},{Text(stringResource(label))},Modifier.heightIn(min=48.dp).testTag("equipment-tab-$id"))}}}
        item {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                FableIcon(Glyph.Kit,tint=MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Text("Моё снаряжение",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                FilledTonalIconButton({editing=EquipmentItem(kind=kind,name="")},Modifier.testTag("equipment-add"),enabled=!busy) {
                    FableIcon(Glyph.Plus,description=stringResource(R.string.equipment_add))
                }
            }
        }
        item{FilterChip(archived,{archived=!archived},label={Text("Архив")},leadingIcon={FableIcon(Glyph.Archive)},modifier=Modifier.testTag("equipment-show-archive"))}
        if(error)item{InfoCard(stringResource(R.string.save_error),stringResource(R.string.equipment_save_error))}
        val shown=items.filter{it.kind==kind&&it.archived==archived}
        if(shown.isEmpty())item{InfoCard(stringResource(R.string.empty_equipment_title),stringResource(R.string.equipment_empty_hint),icon=Glyph.Bow)}
        items(shown,key={it.id}) { item ->
            FableCard(Modifier.testTag("equipment-card-${item.id}")) {
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    FableIcon(when(item.kind){"bow"->Glyph.Bow;"arrows"->Glyph.Arrow;else->Glyph.Kit},tint=MaterialTheme.colorScheme.primary)
                    Text(item.name,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    IconButton({editing=item},Modifier.testTag("equipment-edit-${item.id}"),enabled=!busy) {
                        FableIcon(Glyph.Edit,description="Изменить ${item.name}")
                    }
                }
                val description=if(item.kind=="setup") listOfNotNull(items.firstOrNull{it.id==item.bowId}?.name,items.firstOrNull{it.id==item.arrowsId}?.name).joinToString(" · ")
                    else listOfNotNull(item.category?.let{bowCategoryLabel(it)},item.model?.takeIf{it.isNotBlank()}).joinToString(" · ")
                if(description.isNotBlank())Text(description,style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                if (item.kind == "arrows") {
                    item.numberedCount?.let { count ->
                        Text("Номера стрел 1–$count", style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconToggleButton(item.favorite,{favorite->onSave(item.copy(favorite=favorite)){}},Modifier.size(48.dp).testTag("equipment-favorite-${item.id}"),enabled=!busy,
                            colors=IconButtonDefaults.iconToggleButtonColors(
                                containerColor=androidx.compose.ui.graphics.Color.Transparent,
                                checkedContainerColor=androidx.compose.ui.graphics.Color.Transparent,
                                checkedContentColor=MaterialTheme.colorScheme.primary)) {
                            FableIcon(if(item.favorite)Glyph.FavoriteFilled else Glyph.Favorite,tint=if(item.favorite)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                description=if(item.favorite)"Убрать из избранного"else"В избранное")
                        }
                        if (item.kind == "arrows" && onArrowAnalysis != null && statisticVisible(StatisticFeature.NumberedArrows)) IconButton({ onArrowAnalysis(item.id) },
                            Modifier.testTag("equipment-arrow-analysis-${item.id}"), enabled = !busy) {
                            FableIcon(Glyph.Progress, description = "Статистика по номерам стрел")
                        }
                    }
                    TextButton({onSave(item.copy(archived=!item.archived)){}},Modifier.testTag("equipment-archive-${item.id}"),enabled=!busy,
                        colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.onSurfaceVariant)) {
                        FableIcon(if(item.archived)Glyph.Undo else Glyph.Archive)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(if(item.archived)R.string.equipment_restore else R.string.equipment_archive))
                    }
                }
            }
        }
    }
}

private val equipmentKinds=listOf("bow" to R.string.equipment_bows,"arrows" to R.string.equipment_arrows,"setup" to R.string.equipment_setups)

@Composable
fun bowCategoryLabel(value:String)=stringResource(when(value){"barebow"->R.string.bow_barebow;"recurve"->R.string.bow_recurve;"compound"->R.string.bow_compound;"traditional"->R.string.bow_traditional;"longbow"->R.string.bow_longbow;else->R.string.bow_other})

@Composable
internal fun EquipmentEditor(original:EquipmentItem,items:List<EquipmentItem>,busy:Boolean,error:Boolean,onCancel:()->Unit,onSaveComponent:((EquipmentItem,()->Unit)->Unit)?=null,onSave:(EquipmentItem)->Unit) {
    var name by rememberSaveable(original.id){mutableStateOf(original.name)}
    var model by rememberSaveable(original.id){mutableStateOf(original.model.orEmpty())}
    var notes by rememberSaveable(original.id){mutableStateOf(original.notes.orEmpty())}
    var category by rememberSaveable(original.id){mutableStateOf(original.category)}
    var bow by rememberSaveable(original.id){mutableStateOf(original.bowId)}
    var arrows by rememberSaveable(original.id){mutableStateOf(original.arrowsId)}
    var favorite by rememberSaveable(original.id){mutableStateOf(original.favorite)}
    var addingKind by rememberSaveable(original.id) { mutableStateOf<String?>(null) }
    var componentId by rememberSaveable(original.id) { mutableStateOf("") }
    val scroll = rememberScrollState()
    val fieldSpecs=when(original.kind){"bow"->listOf("drawWeightLb" to R.string.equipment_weight_lb,"drawLengthIn" to R.string.equipment_draw_in);"arrows"->listOf("spine" to R.string.equipment_spine,"lengthMm" to R.string.equipment_length_mm,"massGrain" to R.string.equipment_mass_grain,"diameterMm" to R.string.equipment_diameter_mm,"numberedCount" to R.string.equipment_numbered);else->emptyList()}
    val defaults=mapOf("drawWeightLb" to original.drawWeightLb,"drawLengthIn" to original.drawLengthIn,"spine" to original.spine,"lengthMm" to original.lengthMm,"massGrain" to original.massGrain,"diameterMm" to original.diameterMm,"numberedCount" to original.numberedCount)
    val values=remember(original.id){mutableStateMapOf<String,String>().apply{defaults.forEach{(key,value)->put(key,value?.toString().orEmpty())}}}
    fun numeric(key:String)=values[key].orEmpty().replace(',','.').toDoubleOrNull()?.takeIf{it.isFinite()&&it>0}
    fun fieldValid(key:String):Boolean = values[key].orEmpty().isBlank() || numeric(key)?.let {
        when(key) {
            "spine" -> it % 1.0 == 0.0 && it <= Int.MAX_VALUE
            "numberedCount" -> it % 1.0 == 0.0 && it <= 1000
            "diameterMm" -> app.fableshot.android.domain.ArrowShaft.validDiameter(it)
            else -> true
        }
    } == true
    val valid=fieldSpecs.all{(key,_)->fieldValid(key)}
    fun addComponent(kind: String) {
        componentId = java.util.UUID.randomUUID().toString()
        addingKind = kind
    }
    fun editComponent(item: EquipmentItem) {
        componentId = item.id
        addingKind = item.kind
    }
    if (addingKind != null && onSaveComponent != null) {
        val kind = addingKind!!
        val child = remember(componentId) { items.firstOrNull { it.id==componentId } ?: EquipmentItem(id=componentId, kind=kind, name="") }
        val creating = remember(componentId) { items.none { it.id==componentId } }
        BackHandler { if (!busy) addingKind = null }
        EquipmentEditor(child, items, busy, error, onCancel={addingKind=null}) { value ->
            onSaveComponent(value) {
                if (creating) {
                    if (kind == "bow") bow = value.id else arrows = value.id
                }
                addingKind = null
            }
        }
        return
    }
    Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(20.dp).testTag("equipment-editor"),verticalArrangement=Arrangement.spacedBy(14.dp)) {
        Text(stringResource(R.string.equipment_card),style=MaterialTheme.typography.headlineLarge)
        OutlinedTextField(name,{name=it.take(100)},Modifier.fillMaxWidth().testTag("equipment-name"),label={Text(stringResource(R.string.equipment_name))},singleLine=true)
        if(original.kind=="bow") Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(category==null,{category=null},{Text(stringResource(R.string.equipment_unspecified))},Modifier.heightIn(min=48.dp))
            EquipmentRepository.BOW_CATEGORIES.forEach{value->FilterChip(category==value,{category=value},{Text(bowCategoryLabel(value))},Modifier.heightIn(min=48.dp).testTag("bow-category-$value"))}
        }
        if(original.kind!="setup")OutlinedTextField(model,{model=it.take(100)},Modifier.fillMaxWidth(),label={Text(stringResource(R.string.equipment_model))})
        if(original.kind=="setup") {
            EquipmentChoice(stringResource(R.string.equipment_bows),items.filter{it.kind=="bow"&&!it.archived},bow,{bow=it},enabled=!busy,
                onAdd=if(onSaveComponent!=null)({addComponent("bow")})else null,
                onEdit=if(onSaveComponent!=null)({editComponent(it)})else null,addDescription="Добавить лук")
            EquipmentChoice(stringResource(R.string.equipment_arrows),items.filter{it.kind=="arrows"&&!it.archived},arrows,{arrows=it},enabled=!busy,
                onAdd=if(onSaveComponent!=null)({addComponent("arrows")})else null,
                onEdit=if(onSaveComponent!=null)({editComponent(it)})else null,addDescription="Добавить стрелы")
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val columns=if(maxWidth.value/LocalDensity.current.fontScale>=280)2 else 1
            Column(verticalArrangement=Arrangement.spacedBy(14.dp)) {
                fieldSpecs.chunked(columns).forEach { row ->
                    Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                        row.forEach { (key,label) ->
                            OutlinedTextField(values[key].orEmpty(),{values[key]=it.take(12)},Modifier.weight(1f).testTag("equipment-field-$key"),label={Text(stringResource(label))},singleLine=true,
                                supportingText=if(key=="diameterMm")({Text("1–20 мм · без значения — 6 мм")})else null,
                                keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),isError=!fieldValid(key))
                        }
                        if(columns==2&&row.size==1)Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        OutlinedTextField(notes,{notes=it.take(2000)},Modifier.fillMaxWidth(),label={Text(stringResource(R.string.equipment_notes))},minLines=2)
        Row(verticalAlignment=Alignment.CenterVertically){Switch(favorite,{favorite=it});Spacer(Modifier.width(12.dp));Text(stringResource(R.string.equipment_favorite))}
        if(error)Text(stringResource(R.string.equipment_save_error),color=MaterialTheme.colorScheme.error)
        FablePrimaryButton(stringResource(if(busy)R.string.saving else R.string.save),{onSave(original.copy(name=name,model=model,notes=notes,category=category,bowId=bow,arrowsId=arrows,favorite=favorite,
            drawWeightLb=numeric("drawWeightLb"),drawLengthIn=numeric("drawLengthIn"),spine=numeric("spine")?.toInt(),lengthMm=numeric("lengthMm"),massGrain=numeric("massGrain"),diameterMm=numeric("diameterMm"),numberedCount=numeric("numberedCount")?.toInt()))},Modifier.fillMaxWidth().testTag("equipment-save"),enabled=!busy&&name.isNotBlank()&&valid)
        TextButton(onCancel,Modifier.fillMaxWidth(),enabled=!busy){Text(stringResource(R.string.cancel))}
    }
}

@Composable
fun EquipmentChoice(title:String,items:List<EquipmentItem>,selected:String?,onSelect:(String?)->Unit,enabled:Boolean=true,onAdd:(()->Unit)?=null,onEdit:((EquipmentItem)->Unit)?=null,addDescription:String="Добавить снаряжение") {
    Text(title+(items.firstOrNull{it.id==selected}?.name?.let{" · $it"}?:""),style=MaterialTheme.typography.titleSmall)
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically) {
        FilterChip(selected==null,{onSelect(null)},{Text(stringResource(R.string.equipment_none))},Modifier.heightIn(min=48.dp),enabled=enabled)
        items.forEach { item ->
            FilterChip(selected==item.id,{onSelect(item.id)},{androidx.compose.material3.Text(item.name)},
                Modifier.heightIn(min=48.dp).testTag("equipment-select-${item.id}"),enabled=enabled,
                trailingIcon=if(onEdit!=null && selected==item.id) ({
                    IconButton({onEdit(item)},Modifier.size(48.dp).testTag("equipment-edit-choice-${item.id}"),enabled=enabled) {
                        FableIcon(Glyph.Edit,description="Изменить снаряжение")
                    }
                }) else null)
        }
        onAdd?.let { action ->
            IconButton(action,Modifier.size(48.dp).testTag("equipment-add-choice"),enabled=enabled) {
                FableIcon(Glyph.Plus,description=addDescription)
            }
        }
    }
}
