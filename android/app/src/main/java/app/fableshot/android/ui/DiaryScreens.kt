package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledDropdownMenu as DropdownMenu

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import app.fableshot.android.R
import app.fableshot.android.data.*
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale

private val dateFormat = DateTimeFormatter.ofPattern("d MMM", Locale.forLanguageTag("ru"))
private fun date(value: Long) = Instant.ofEpochMilli(value).atZone(ZoneId.systemDefault()).toLocalDate()
internal fun sessionDate(value:SessionSummary):LocalDate?=value.journalMeta?.localDate?.let{runCatching{LocalDate.parse(it)}.getOrNull()}?:if(value.journalMeta?.dateKnown==false)null else date(value.startedAt)
internal fun number(value: Double, places: Int = 1) = String.format(Locale.forLanguageTag("ru"), "%.$places" + "f", value)

@Composable
fun SectionHeading(title: String, action: String? = null, onAction: () -> Unit = {}, icon: Glyph = Glyph.Progress) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        FableIcon(icon,tint=MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(12.dp))
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
        if (action != null) TextButton(onClick = onAction) { Text(action, style = MaterialTheme.typography.labelMedium); FableIcon(Glyph.Next, Modifier.size(16.dp)) }
    }
}

@Composable
fun HomeScreen(sessions: List<SessionSummary>, active: SessionDetails?, settings: UserSettings, onStart: () -> Unit, onContinue: () -> Unit, onHistory: () -> Unit, onSession: (SessionSummary) -> Unit,onTechnique:(()->Unit)?=null,
    habitualPlan: app.fableshot.android.data.journal.BlockPlan? = null,
    quickStartAvailable: Boolean = true,
    busy: Boolean = false,
    onQuickStart: () -> Unit = onStart,
    onChangeConditions: () -> Unit = onStart,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
    val compact = maxWidth < 360.dp || LocalDensity.current.fontScale > 1.15f
    val pagePadding = if(compact) 16.dp else 20.dp
    val today = LocalDate.now()
    val recent = sessions.filter { session ->
        session.state=="completed" && session.shotCount>0 && sessionDate(session)?.let { it<=today }==true
    }.sortedWith(compareByDescending<SessionSummary> { sessionDate(it) }
        .thenByDescending { it.startedAt }.thenByDescending { it.id }).take(5)
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showPractice = statisticVisible(StatisticFeature.Result) ||
        statisticVisible(StatisticFeature.Average) || showVolume
    LazyColumn(Modifier.fillMaxSize().testTag("home-screen"), contentPadding = PaddingValues(pagePadding), verticalArrangement = Arrangement.spacedBy(if(compact)16.dp else 20.dp)) {
        item {
            val darkInk = Color(0xFF152319)
            val visuals = LocalFableVisuals.current
            Surface(Modifier.fillMaxWidth().testTag("home-hero"), shape = RoundedCornerShape(visuals.cardRadius), color = darkInk) {
                Box {
                    Box(Modifier.matchParentSize().fableGeometry(pattern=GeometryPattern.Satellites,tint=visuals.action))
                    Column(Modifier.padding(if(compact)16.dp else 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.size(7.dp).background(visuals.action, CircleShape))
                            Eyebrow(if(compact && active==null && habitualPlan!=null) "ПРИВЫЧНАЯ" else stringResource(if (active == null) R.string.ready_for_training else R.string.in_progress), color=Color(0xFFD9E8D1))
                        }
                        if(compact && active==null && habitualPlan!=null) FittedLine("Тренировка",MaterialTheme.typography.titleLarge,Color.White)
                        else Text(if(active==null && habitualPlan!=null) "Привычная тренировка" else stringResource(if (active == null) R.string.start_hero else R.string.continue_hero), color=Color.White, style=if(habitualPlan!=null)MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineMedium, maxLines=2, overflow=TextOverflow.Ellipsis)
                        if (active == null && habitualPlan != null) {
                            HomeConditions(habitualPlan.mode, habitualPlan.targetProfileId, habitualPlan.diameterMm,
                                habitualPlan.distanceMeters, habitualPlan.equipmentSnapshotJson, habitualPlan.arrows,
                                habitualPlan.forOpenPractice().seriesPerRound, habitualPlan.roundArrowLimit)
                        }
                        else if (active != null) {
                            val block = active.journal?.currentBlock?.block
                            HomeConditions(block?.mode ?: "scored", block?.targetProfileId ?: active.session.profileId,
                                block?.targetDiameterMm ?: active.session.targetDiameterMm,
                                block?.distanceMeters ?: active.session.distanceMeters, block?.equipmentSnapshotJson,
                                block?.defaultArrowsPerEnd ?: active.session.arrowsPerEnd,
                                active.journal?.plans?.singleOrNull()?.seriesLimit,
                                active.journal?.plans?.singleOrNull()?.roundArrowLimit)
                        }
                        FablePrimaryButton(
                            if (active != null) stringResource(R.string.continue_training) else if (habitualPlan != null && quickStartAvailable) "Начать" else if(habitualPlan != null) "Выбрать снаряжение" else stringResource(R.string.new_session),
                            if (active != null) onContinue else if (habitualPlan != null && quickStartAvailable) onQuickStart else onChangeConditions,
                            Modifier.fillMaxWidth().testTag("home-primary"), enabled = !busy, icon = Glyph.Start,
                        )
                        if (active == null && habitualPlan != null) {
                            TextButton(onChangeConditions, Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("home-conditions").semantics { contentDescription="Изменить условия" }) {
                                if(compact) { FableIcon(Glyph.Edit,tint=Color.White);Spacer(Modifier.width(8.dp)) }
                                Text(if(compact) "Условия" else "Изменить условия", color=Color.White, maxLines=1)
                            }
                        }
                    }
                }
            }
        }
        if (showVolume) item {
            Column(Modifier.testTag("home-all-time-totals"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    MetricTile(sessions.sumOf { it.shotCount }.toString(), stringResource(R.string.arrows_label), Modifier.weight(1f), Glyph.Target)
                    MetricTile(sessions.size.toString(), stringResource(R.string.sessions_label), Modifier.weight(1f), Glyph.Calendar)
                }
            }
        }
        if (showPractice) item {
            FableCard(Modifier.testTag("home-week")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.practice_week),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                    FableIcon(Glyph.Spark, tint = MaterialTheme.colorScheme.primary)
                }
                if(recent.isNotEmpty()) PracticeTimeline(recent,onSession)
                else Text("Пока нет завершённых тренировок со стрелами и известной датой.",
                    Modifier.testTag("home-practice-empty"),style=MaterialTheme.typography.bodySmall)
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
    }
}

@Composable
private fun HomeConditions(mode: String, profileId: String?, diameterMm: Int?, distanceMeters: Double?,
    equipmentJson: String?, arrows: Int, series: Int?, roundArrows: Int? = null) {
    val equipment = remember(equipmentJson) { equipmentJson?.let { runCatching { org.json.JSONObject(it) }.getOrNull() } }
    val bow = equipment?.optJSONObject("bow")?.optString("name")?.takeIf(String::isNotBlank)
        ?: equipment?.optJSONObject("selection")?.optString("name")?.takeIf(String::isNotBlank)
    val arrowName = equipment?.optJSONObject("arrows")?.optString("name")?.takeIf(String::isNotBlank)
    val target = app.fableshot.android.domain.TargetCatalog.find(profileId)?.title?.removePrefix("Indoor · ")
    val values = buildList {
        if (mode == "count_only") add(ConditionValue(Glyph.Target, "Счётчик стрел", "Режим: счётчик стрел"))
        else {
            val size = diameterMm?.let { "${number(it / 10.0, if (it % 10 == 0) 0 else 1)} см" } ?: "Размер не указан"
            add(ConditionValue(Glyph.Target, listOfNotNull(size, target).joinToString(" · "), "Мишень: $size. ${target.orEmpty()}"))
            val distance = distanceMeters?.let { "${number(it, if (it % 1.0 == 0.0) 0 else 1)} м" } ?: "Не указана"
            add(ConditionValue(Glyph.Distance, distance, "Дистанция: $distance"))
        }
        bow?.let { add(ConditionValue(Glyph.Bow, it, "Лук или комплект: $it")) }
    val volume = "$arrows в серии" + (roundArrows?.let { " · $it в раунде" }
        ?: series?.let { " · $it серий" } ?: " · без лимита")
        add(ConditionValue(Glyph.Arrow, listOfNotNull(arrowName, volume).joinToString(" · "),
            "Стрелы: ${arrowName.orEmpty()}. $volume"))
    }
    ConditionsGrid(values, Modifier.testTag("home-conditions-grid"), color = Color(0xFFCBD7C7))
}

@Composable
fun MetricTile(value: String, label: String, modifier: Modifier = Modifier, icon: Glyph = Glyph.Target,
    valueModifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    FableCard(modifier) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val density = LocalDensity.current
            val measurer = rememberTextMeasurer()
            val valueStyle = MaterialTheme.typography.headlineMedium
            fun widestWord(text: String, style: TextStyle) = text.split(' ').filter(String::isNotBlank).maxOfOrNull {
                measurer.measure(it, style, softWrap = false).size.width
            } ?: 0
            val wordWidth = maxOf(widestWord(value, valueStyle), widestWord(label, MaterialTheme.typography.bodySmall))
            // Both the number and its label must fit beside the icon and optional action.
            val inlineWidth = with(density) { wordWidth.toDp() } + 36.dp + if (action == null) 0.dp else 60.dp
            if (maxWidth < inlineWidth) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        FableIcon(icon, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.weight(1f))
                        action?.invoke()
                    }
                    MetricTileValues(value, label, valueModifier)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    FableIcon(icon, tint = MaterialTheme.colorScheme.primary)
                    Box(Modifier.weight(1f)) { MetricTileValues(value, label, valueModifier) }
                    action?.invoke()
                }
            }
        }
    }
}

@Composable
private fun MetricTileValues(value: String, label: String, valueModifier: Modifier) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Box(valueModifier.semantics(mergeDescendants = true) {}) {
            TrainingSummaryValue(value, Modifier.fillMaxWidth(), style = MaterialTheme.typography.headlineMedium,
                maxLines = Int.MAX_VALUE, alignment = Alignment.CenterStart)
        }
        GlossaryText(label, emptyMap(), style = MaterialTheme.typography.bodySmall.copy(
            color = MaterialTheme.colorScheme.onSurfaceVariant))
    }
}

/** Fit to the available width before drawing, keeping the original line height. */
@Composable
internal fun FittedLine(
    text: String,
    style: TextStyle,
    color: Color,
    animate: Boolean = false,
    alignment: Alignment = Alignment.CenterStart,
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().height(with(density) { style.lineHeight.toDp() }), contentAlignment = alignment) {
        val width = with(density) { maxWidth.roundToPx() }
        val fontSize = remember(text, style, width, density.fontScale, measurer) {
            var low = minOf(4f, style.fontSize.value)
            var high = style.fontSize.value
            fun fits(size: Float) = !measurer.measure(text, style.copy(fontSize=size.sp), constraints=Constraints(maxWidth=(width-2).coerceAtLeast(0)), maxLines=1, softWrap=false).didOverflowWidth
            if (fits(high)) high.sp else {
                repeat(8) {
                    val middle = (low + high) / 2
                    if (fits(middle)) low = middle else high = middle
                }
                low.sp
            }
        }
        if (animate) SlidingValue(text, Modifier.fillMaxWidth(), style=style.copy(fontSize=fontSize), color=color)
        else Text(text, style=style.copy(fontSize=fontSize), color=color, maxLines=1, softWrap=false, overflow=TextOverflow.Ellipsis)
    }
}

@Composable
fun SessionCard(
    value: SessionSummary,
    deleted: Boolean = false,
    restoreEnabled: Boolean = true,
    onRestore: () -> Unit = {},
    showDate: Boolean = true,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    val cardModifier = Modifier.fillMaxWidth().testTag("session-${value.id}")
    val deletedTint = Color(0xFFF2A9BB)
    val meta = value.journalMeta
    val conditions = buildList {
        when {
            meta?.countOnly == true -> add(ConditionValue(Glyph.Target, stringResource(R.string.count_mode), "Режим: счётчик стрел"))
            meta?.blockCount?.let { it > 1 } == true -> {
                val label = stringResource(R.string.mixed_conditions, meta.blockCount)
                add(ConditionValue(Glyph.Target, label, label))
            }
            else -> {
                val target = if (meta?.diameterKnown == false) "Размер неизвестен"
                    else "${number(value.targetDiameterMm / 10.0, if (value.targetDiameterMm % 10 == 0) 0 else 1)} см"
                val distance = if (meta?.distanceKnown == false) "Неизвестна"
                    else "${number(value.distanceMeters, if (value.distanceMeters % 1.0 == 0.0) 0 else 1)} м"
                add(ConditionValue(Glyph.Target, target, "Мишень: $target"))
                add(ConditionValue(Glyph.Distance, distance, "Дистанция: $distance"))
            }
        }
        meta?.equipmentLabel?.takeIf(String::isNotBlank)?.let { add(ConditionValue(Glyph.Bow, it, "Снаряжение: $it")) }
        val arrows = stringResource(R.string.session_arrow_count, value.shotCount)
        add(ConditionValue(Glyph.Arrow, arrows, arrows))
    }
    Surface(
        modifier = if (deleted) cardModifier else cardModifier.clip(shape).clickable(onClick = onClick),
        shape = shape,
        color = if (deleted) deletedTint.copy(alpha = .13f).compositeOver(MaterialTheme.colorScheme.surface) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, if (deleted) deletedTint.copy(alpha = .45f) else MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(if (showDate) 16.dp else 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (showDate) Column(Modifier.width(40.dp).testTag("session-date-${value.id}"), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(sessionDate(value)?.dayOfMonth?.toString() ?: "—", style = MaterialTheme.typography.headlineSmall)
                    Text(sessionDate(value)?.format(DateTimeFormatter.ofPattern("MMM", Locale.forLanguageTag("ru")))?.uppercase()
                        ?: stringResource(R.string.history_pick_date), style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(value.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (deleted) IconButton(onRestore, Modifier.testTag("restore-${value.id}"), enabled = restoreEnabled) {
                    FableIcon(Glyph.Undo, description = stringResource(R.string.trash_restore))
                } else FableIcon(Glyph.Next, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Column {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(if (value.scoredCount > 0) value.total.toString() else "—", style = MaterialTheme.typography.headlineSmall)
                        Text(if (value.scoredCount > 0) "/ ${value.scoredCount * 10}" else stringResource(R.string.no_scored_result),
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (value.scoredCount > 0) Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.testTag("session-average-${value.id}")
                        .semantics(mergeDescendants = true) { contentDescription = "Средний балл" }) {
                    FableIcon(Glyph.Progress, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(averageNumber(value.total.toDouble() / value.scoredCount), style = MaterialTheme.typography.titleMedium)
                }
                HistoryRankBadge(value)
                meta?.progressPresentation()?.let { progress ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FableIcon(Glyph.Spark, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                        ProgressChangeValue(progress, progress.explanation(meta.progressSourceCount),
                            Modifier.testTag("session-progress-${value.id}"))
                    }
                }
            }
            ConditionsGrid(conditions, Modifier.testTag("session-conditions-${value.id}"))
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun HistoryScreen(
    sessions: List<SessionSummary>,
    onSession: (SessionSummary) -> Unit,
    onStart: () -> Unit,
    deletedSessions: List<SessionSummary> = emptyList(),
    initiallyDeleted: Boolean = false,
    restoreEnabled: Boolean = true,
    onRestore: (String) -> Unit = {},
) {
    var deletedOnly by rememberSaveable { mutableStateOf(initiallyDeleted) }
    val visibleSessions = if (deletedOnly) deletedSessions else sessions
    var showFilters by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var days by rememberSaveable { mutableIntStateOf(0) }
    var dayMillis by rememberSaveable{mutableStateOf<Long?>(null)}
    var calendar by remember{mutableStateOf(false)}
    val picker=rememberDatePickerState(initialSelectedDateMillis=dayMillis)
    val selectedDate=dayMillis?.let{Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()}
    val firstDate = if (days == 0) null else LocalDate.now().minusDays((days - 1).toLong())
    val filtered = visibleSessions.filter { it.title.contains(query.trim(), ignoreCase = true) &&
        (firstDate == null || historyTrainingDate(it)?.let { day -> day >= firstDate } == true) &&
        (selectedDate == null || historyTrainingDate(it) == selectedDate) }
    val timeline = remember(filtered) { historyTimelineItems(filtered) }
    LazyColumn(Modifier.fillMaxSize().testTag("history-screen"), contentPadding = PaddingValues(start=20.dp,end=20.dp,top=20.dp,bottom=100.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) { OutlinedTextField(query, { query = it }, Modifier.weight(1f).testTag("history-search"), label = { Text(stringResource(R.string.search_history)) }, singleLine = true, shape = RoundedCornerShape(18.dp))
            IconButton({showFilters=!showFilters}, Modifier.testTag("history-filters")) { FableIcon(Glyph.Filters,description="Фильтры истории") }
        } }
        if(showFilters || deletedOnly || days!=0 || dayMillis!=null) item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!deletedOnly, { deletedOnly = false }, { Text("Тренировки") }, Modifier.heightIn(min = 48.dp).testTag("history-current"))
                FilterChip(deletedOnly, { deletedOnly = true }, { Text("Удалённые (${deletedSessions.size})") }, Modifier.heightIn(min = 48.dp).testTag("history-deleted"), leadingIcon = { FableIcon(Glyph.Trash, Modifier.size(18.dp)) })
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                listOf(0 to R.string.period_all, 7 to R.string.period_week, 30 to R.string.period_month).forEach { (n, label) -> FilterChip(days == n&&dayMillis==null, { days = n;dayMillis=null }, { Text(stringResource(label)) }, modifier = Modifier.heightIn(min = 48.dp)) }
                FilterChip(dayMillis!=null,{picker.selectedDateMillis=dayMillis;calendar=true},{Text(selectedDate?.format(dateFormat)?:stringResource(R.string.history_pick_date))},Modifier.heightIn(min=48.dp).testTag("history-calendar"))
            }
            }
        }
        item { Eyebrow(stringResource(R.string.history_count, filtered.size)) }
        if (filtered.isEmpty()) item {
            InfoCard(stringResource(if (deletedOnly && visibleSessions.isEmpty()) R.string.trash_empty else if (visibleSessions.isEmpty()) R.string.empty_history_title else R.string.empty_filtered_title), stringResource(if (deletedOnly) R.string.trash_hint else if (visibleSessions.isEmpty()) R.string.empty_history_text else R.string.empty_filtered_text), icon = if (deletedOnly) Glyph.Trash else Glyph.History)
            if (!deletedOnly && sessions.isEmpty()) { Spacer(Modifier.height(16.dp)); FablePrimaryButton(stringResource(R.string.new_session), onStart, Modifier.fillMaxWidth()) }
        }
        items(timeline, key = { it.key }) { item ->
            when (item) {
                is HistoryTimelineItem.Session -> HistoryTimelineRow(item, deletedOnly, restoreEnabled,
                    onRestore = { onRestore(item.value.id) }, onClick = { onSession(item.value) })
                else -> HistoryTimelineHeading(item, arrow = item.key == timeline.first().key)
            }
        }
    }
    if(calendar)DatePickerDialog(onDismissRequest={calendar=false},confirmButton={TextButton({dayMillis=picker.selectedDateMillis;days=0;calendar=false},enabled=picker.selectedDateMillis!=null){Text(stringResource(R.string.done))}},dismissButton={TextButton({calendar=false}){Text(stringResource(R.string.cancel))}}){DatePicker(picker)}
}

@Composable
fun ProgressResults(sessions: List<SessionSummary>) {
    val groups = remember(sessions) { progressConditionGroups(sessions) }
    var selected by rememberSaveable { mutableStateOf("") }
    val group = groups.firstOrNull { it.key == selected } ?: groups.firstOrNull()
    val values = group?.rows.orEmpty()
    val showAverage = statisticVisible(StatisticFeature.Average)
    val showVolume = statisticVisible(StatisticFeature.Volume)
    val showProgress = statisticVisible(StatisticFeature.ProgressScore)
    val showMap = statisticVisible(StatisticFeature.HitMap) ||
        statisticVisible(StatisticFeature.Grouping) || statisticVisible(StatisticFeature.Offset)
    val showGeometryTrend = statisticVisible(StatisticFeature.GeometryTrend) &&
        (statisticVisible(StatisticFeature.Grouping) || statisticVisible(StatisticFeature.Offset))
    val showDistribution = statisticVisible(StatisticFeature.Distribution)
    val showZoneTrend = statisticVisible(StatisticFeature.ZoneTrend)
    val showTrend = statisticVisible(StatisticFeature.ProgressTrend) &&
        (showAverage || statisticVisible(StatisticFeature.Grouping))
    val showDetails = showAverage || showVolume || showProgress || showMap || showGeometryTrend || showDistribution || showZoneTrend
    LazyColumn(Modifier.fillMaxSize().testTag("progress-screen"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
            Text("Обзор результатов",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
        } }
        if (showTrend) item("progress-trend") { ProgressTrendCard(sessions) }
        if (!showTrend && !showDetails) item {
            Text("Показатели скрыты в настройках статистики.", Modifier.testTag("statistics-hidden"))
        }
        if (values.isNotEmpty() && showDetails) {
            if(group != null) item {
                var choosingGroup by rememberSaveable { mutableStateOf(false) }
                Box {
                    if (groups.size == 1) {
                        Text(group.label + if (showVolume) " · тренировок: ${values.size}" else "", style = MaterialTheme.typography.titleSmall)
                    } else OutlinedButton({choosingGroup=true}, Modifier.fillMaxWidth().testTag("progress-conditions")) {
                        Text(group.label + if (showVolume) " · тренировок: ${values.size}" else "")
                    }
                    DropdownMenu(choosingGroup,{choosingGroup=false}, Modifier.heightIn(max = 320.dp)) {
                        groups.forEach { item ->
                            DropdownMenuItem(text = { Text(item.label + if (showVolume) " · тренировок: ${item.rows.size}" else "") },
                                onClick = { selected = item.key; choosingGroup = false })
                        }
                    }
                }
            }
            if (showProgress) values.lastOrNull()?.journalMeta?.let { meta ->
                meta.progressPresentation()?.let { progress -> item {
                    FableCard {
                        Row(verticalAlignment=Alignment.CenterVertically) {
                            androidx.compose.material3.Text("Прогресс",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                            HelpButton("О прогрессе",progress.explanation(meta.progressSourceCount),iconOnly=true)
                        }
                        ProgressChangeValue(progress,progress.explanation(meta.progressSourceCount),style=MaterialTheme.typography.headlineMedium)
                    }
                } }
            }
            if (showAverage) item {
                FableCard {
                    Eyebrow(stringResource(R.string.average_label))
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) { Text(averageNumber(values.sumOf { it.total }.toDouble() / values.sumOf { it.scoredCount }), style = MaterialTheme.typography.displayMedium); Text("/ 10", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 7.dp)) }
                    if (values.size >= 2) {
                        val difference = values.last().let { it.total.toDouble()/it.scoredCount } - values[values.lastIndex - 1].let { it.total.toDouble()/it.scoredCount }
                        Text(stringResource(R.string.difference_points, (if (difference > 0) "+" else "") + number(difference)), color = if (difference >= 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.previous_comparison), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    } else Text(stringResource(R.string.one_more_for_comparison), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (showMap) item { GeometryAnalytics(values) }
            if (showGeometryTrend) item { GeometryTrend(values) }
            if (showDistribution || showZoneTrend) item { ZoneAnalytics(values) }
            if (showVolume || showAverage) item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (showVolume) MetricTile(values.size.toString(), stringResource(R.string.completed_sessions), Modifier.weight(1f), Glyph.Calendar)
                    if (showAverage) MetricTile(averageNumber(values.maxOf { it.total.toDouble()/it.scoredCount }), stringResource(R.string.best_average), Modifier.weight(1f), Glyph.Trophy)
                }
            }
        }
    }
}
