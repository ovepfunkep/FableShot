package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import app.fableshot.android.ui.ScaledAlertDialog as AlertDialog

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.Text as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fableshot.android.data.journal.*
import app.fableshot.android.data.StatisticFeature
import app.fableshot.android.domain.*

data class RankPreferences(
    val category: String? = null,
    val onCategory: (String) -> Unit = {},
    val onConfigureBow: ((JournalDetails) -> Unit)? = null,
)
val LocalRankPreferences = staticCompositionLocalOf { RankPreferences() }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SportRankPanel(details: JournalDetails, compact: Boolean = false, draft: JournalShot? = null, hideLiveResult: Boolean = false, contextLabel: String? = null, summaryColumn: Boolean? = null,
    stageRank: JournalStageRank? = null, badgeModifier: Modifier = Modifier, badgeTag: String = "stage-rank") {
    if (!statisticVisible(StatisticFeature.Norms)) return
    val preferences = LocalRankPreferences.current
    val assessment = stageRank?.assessment ?: remember(details, preferences.category, draft) { details.rankAssessment(preferences.category, draft) }
    val scopedDetails = if (stageRank == null) details else details.stageRankDetails(stageRank)
    var open by rememberSaveable(details.session.id) { mutableStateOf(false) }
    var reference by rememberSaveable(details.session.id) { mutableStateOf(false) }
    val evaluation = assessment.evaluation
    val rankClass = stageRank?.classLabel ?: scopedDetails.rankClassLabel(preferences.category)
    val classLabel = rankClass?.let { " ($it)" }.orEmpty()
    @Composable fun BowTypeAction() {
        val label = requireNotNull(assessment.reason)
        val configureBow = preferences.onConfigureBow
        if (configureBow == null) Text(label)
        else TextButton({ open = false; configureBow(details) }, Modifier.testTag("rank-configure-bow")) {
            MaterialText(label)
        }
    }
    if (stageRank != null) {
        if (!hideLiveResult) Column(badgeModifier.fillMaxWidth().heightIn(min = 32.dp).testTag(badgeTag)
            .clickable(role = Role.Button, onClickLabel = "Разряд: ${stageRank.scopeLabel}") { open = true }
            .semantics(mergeDescendants = true) {
                contentDescription = "${stageRank.scopeLabel}: прогноз разряда ${stageRank.label ?: "недоступен"}$classLabel"
            }, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.Center) {
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                FableIcon(Glyph.Podium, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.primary)
                MaterialText(if (stageRank.label == "ниже порога") "ниже" else stageRank.label ?: "—",
                    Modifier.testTag("$badgeTag-level"), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary, maxLines = 1, softWrap = false,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
            MaterialText(rankClass ?: " ", Modifier.testTag("$badgeTag-class"),
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, softWrap = false, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    } else if (compact && summaryColumn != null) {
        if (!hideLiveResult) TrainingRankSummary(assessment, details.rankClassLabel(preferences.category)) { open = true }
    } else if (compact) {
        val description = "Темп сравнивается с числовыми нормами выбранного формата. Это прогноз, а не присвоение разряда."
        TrainingMetricRow(Modifier.height(32.dp).testTag("rank-pace"), left = { column ->
            val text="Разряд$classLabel: ${if (hideLiveResult) "скрыт" else evaluation?.let { if (it.entered == 0) "—" else it.pace?.label ?: "ниже порога" } ?: "—"}"
            val style=MaterialTheme.typography.labelLarge
            val measurer=androidx.compose.ui.text.rememberTextMeasurer()
            val density=androidx.compose.ui.platform.LocalDensity.current
            BoxWithConstraints(column) {
                val width=(constraints.maxWidth-2).coerceAtLeast(0)
                val fontSize=remember(text,style,width,measurer,density.fontScale) {
                    var low=4f
                    var high=style.fontSize.value
                    fun fits(size:Float)=!measurer.measure(text,style.copy(fontSize=size.sp),
                        constraints=androidx.compose.ui.unit.Constraints(maxWidth=width),softWrap=false,maxLines=1).didOverflowWidth
                    if (fits(high)) high.sp else {
                        repeat(10) {
                            val middle=(low+high)/2
                            if (fits(middle)) low=middle else high=middle
                        }
                        low.sp
                    }
                }
                GlossaryText(text,mapOf("Разряд" to description),
                    Modifier.fillMaxWidth().testTag("rank-details").clickable(onClickLabel="Разбор нормативов") { open=true },
                    onTermClick={open=true},style=style.copy(fontSize=fontSize),maxLines=1,softWrap=false)
            }
        }, right = { column ->
            val threshold = if (hideLiveResult) "" else evaluation?.next?.let { "${it.label} · от ${number(it.score.toDouble() / evaluation.exercise.arrows, 2)}" }.orEmpty()
            SlidingValue(threshold, column.testTag("rank-threshold"), style=MaterialTheme.typography.labelSmall)
        })
    } else {
        FableCard(modifier = Modifier.testTag("rank-card")) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FableIcon(Glyph.Podium,tint=MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Text("Нормативы", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                IconButton({ open = true }, Modifier.testTag("rank-details")) { FableIcon(Glyph.Help, description = "Разбор нормативов") }
            }
            contextLabel?.let {Text(it,style=MaterialTheme.typography.bodySmall)}
            if (evaluation == null) {
                if (assessment.needsBowType) BowTypeAction()
                else TextButton({ open = true }) { MaterialText(assessment.reason ?: "Уточни условия") }
            } else {
                RankHeadline(assessment)
                RankScale(evaluation)
                if (!assessment.finalResult) Text("${evaluation.entered} стрел · справочный формат ${evaluation.exercise.arrows}",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                RankNext(evaluation, showRemaining=false)
            }
        }
    }
    if (open) ModalBottomSheet(
        onDismissRequest = { open = false },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = {
            Box(Modifier.fillMaxWidth().height(28.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(32.dp, 4.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape))
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal=20.dp, vertical=8.dp).testTag("rank-sheet"), verticalArrangement=Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {
                Text(stageRank?.scopeLabel ?: "Нормативы", Modifier.weight(1f), style=MaterialTheme.typography.titleLarge)
                if (stageRank != null) GlossaryText("Прогноз", mapOf("Прогноз" to "Средний балл только выбранного раунда или серии умножается на число стрел справочного упражнения. Уже одна внесённая стрела даёт прогноз. Полный норматив, условия соревнования и официальное присвоение этим не подтверждаются."), style = MaterialTheme.typography.labelMedium)
            }
            if (evaluation != null) {
                RankHeadline(assessment, large=true)
                Text(exerciseLabel(evaluation.exercise), style=MaterialTheme.typography.bodyMedium, color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            RankTargetConditions(scopedDetails)
            RankCategoryChoice(preferences)
            if (evaluation == null) {
                if (assessment.needsBowType) BowTypeAction() else Text(assessment.reason ?: "Нет подходящего формата")
            }
            else {
                RankScale(evaluation)
                Text("${evaluation.points} очков · ${evaluation.entered} из ${evaluation.exercise.arrows} стрел", style=MaterialTheme.typography.bodyMedium)
                if (!assessment.finalResult) evaluation.projected?.let {
                    Text("Прогноз полного упражнения: ${number(it, 0)} очков", style=MaterialTheme.typography.bodyMedium)
                }
                RankNext(evaluation, showRemaining=stageRank == null)
            }
            RankSourceHelp()
            TextButton({reference=true},Modifier.fillMaxWidth().testTag("open-rank-grid")) {
                FableIcon(Glyph.Book)
                Spacer(Modifier.width(8.dp))
                Text("Вся разрядная сетка")
            }
            Spacer(Modifier.height(8.dp))
        }
    }
    if (reference) RankReferenceScreen(evaluation?.exercise?.bow, preferences.category) { reference=false }
}

@Composable
fun StageRankBadge(
    details: JournalDetails,
    rank: JournalStageRank,
    modifier: Modifier = Modifier,
    hideResult: Boolean = false,
    tag: String = "stage-rank",
) {
    SportRankPanel(details, compact = true, hideLiveResult = hideResult,
        stageRank = rank, badgeModifier = modifier, badgeTag = tag)
}

@Composable
private fun TrainingRankSummary(
    assessment: JournalRankAssessment,
    classLabel: String?,
    onClick: () -> Unit,
) {
    val evaluation = assessment.evaluation
    val belowThreshold = evaluation != null && evaluation.entered > 0 && evaluation.pace == null
    val level = when {
        evaluation == null || evaluation.entered == 0 -> "—"
        belowThreshold -> "ниже порога"
        else -> evaluation.pace!!.label
    }
    val threshold = evaluation?.next?.let { "${it.label} от ${number(it.score.toDouble() / evaluation.exercise.arrows, 2)}" }.orEmpty()
    val textStyle = MaterialTheme.typography.bodySmall
    val levelStyle = MaterialTheme.typography.labelMedium
    val interactive = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("rank-details")
        .clickable(role = Role.Button, onClickLabel = "Разбор нормативов", onClick = onClick)
        .semantics { stateDescription = assessment.reason ?: "Прогноз разряда: $level" }

    @Composable fun Heading() {
        GlossaryText("Разряд", mapOf("Разряд" to "Прогноз по текущему среднему; нажатие открывает разбор нормативов."),
            Modifier.testTag("rank-label"), onTermClick = { onClick() }, style = textStyle,
            maxLines = 1, softWrap = false)
    }
    @Composable fun Category(modifier: Modifier = Modifier) {
        MaterialText(classLabel ?: "—", modifier.testTag("rank-class"),
            style = textStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false)
    }
    @Composable fun Level(modifier: Modifier = Modifier) {
        TrainingSummaryValue(level, modifier.testTag("rank-level"), levelStyle,
            color = if (evaluation?.pace != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            alignment = Alignment.CenterStart)
    }
    @Composable fun Threshold(modifier: Modifier = Modifier) {
        TrainingSummaryValue(threshold, modifier.testTag("rank-threshold"),
            textStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, alignment = Alignment.CenterStart)
    }
    @Composable fun Chevron() {
        MaterialText("›", Modifier.clearAndSetSemantics {}, style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary)
    }
    @Composable fun Caption() {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Heading()
            Category()
        }
    }
    @Composable fun Prefix() {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Caption()
            MaterialText("·", style = textStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Level()
        }
    }

    BoxWithConstraints(Modifier.fillMaxWidth().testTag("rank-pace")) {
        val density = androidx.compose.ui.platform.LocalDensity.current
        val measurer = androidx.compose.ui.text.rememberTextMeasurer()
        fun width(text: String, style: androidx.compose.ui.text.TextStyle) =
            measurer.measure(text, style, maxLines = 1, softWrap = false, density = density).size.width
        val gap = with(density) { 4.dp.roundToPx() }
        val headingWidth = width("Разряд", textStyle)
        val categoryWidth = width("КЛб(М)", textStyle)
        val captionWidth = headingWidth + categoryWidth + gap
        val levelWidth = maxOf(width("ниже порога", levelStyle), width("МСМК", levelStyle))
        val prefixWidth = captionWidth + width("·", textStyle) + levelWidth + 2 * gap
        val thresholdWidth = width("МСМК от 10,00", textStyle)
        val chevronWidth = width("›", MaterialTheme.typography.labelLarge)
        val contentWidth = constraints.maxWidth - with(density) { 24.dp.roundToPx() }
        val oneLine = prefixWidth + thresholdWidth + chevronWidth + 4 * gap <= contentWidth
        val prefixFits = prefixWidth <= contentWidth
        val captionFits = captionWidth + chevronWidth + 2 * gap <= contentWidth
        val rowHeight = (22 * density.fontScale).dp

        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Column(interactive.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically)) {
                if (oneLine) {
                    Row(Modifier.fillMaxWidth().height(rowHeight), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.weight(1f)) { Prefix() }
                        Threshold(Modifier.width(with(density) { thresholdWidth.toDp() }))
                        Chevron()
                    }
                } else if (prefixFits) {
                    Box(Modifier.fillMaxWidth().height(rowHeight), contentAlignment = Alignment.CenterStart) { Prefix() }
                    Row(Modifier.fillMaxWidth().height(rowHeight), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween) {
                        Threshold()
                        Chevron()
                    }
                } else {
                    Row(Modifier.fillMaxWidth().height(rowHeight), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween) {
                        if (captionFits) Caption() else Heading()
                        Chevron()
                    }
                    if (!captionFits) Box(Modifier.fillMaxWidth().height(rowHeight), contentAlignment = Alignment.CenterStart) { Category() }
                    Box(Modifier.fillMaxWidth().height(rowHeight), contentAlignment = Alignment.CenterStart) { Level() }
                    Box(Modifier.fillMaxWidth().height(rowHeight), contentAlignment = Alignment.CenterStart) { Threshold() }
                }
            }
        }
    }
}

@Composable
private fun RankHeadline(assessment: JournalRankAssessment, large: Boolean = false) {
    val evaluation = assessment.evaluation ?: return
    val level = if (assessment.finalResult) evaluation.result else evaluation.pace
    val headline = if (assessment.finalResult) "По очкам: ${level?.label ?: "ниже начального порога"}"
        else "Разряд: ${if (evaluation.entered == 0) "—" else level?.label ?: "ниже начального порога"}"
    Text(headline, Modifier.testTag("rank-headline"), style=if (large) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleMedium)
}

@Composable
private fun RankTargetConditions(details: JournalDetails) {
    val conditions = details.orderedBlocks.map { Triple(it.block.distanceMeters, it.block.targetDiameterMm, it.block.targetProfileId) }.distinct()
    val condition = conditions.singleOrNull()
    if (condition == null) Text("Условия мишени различаются", style=MaterialTheme.typography.bodySmall)
    else {
        val profile = TargetCatalog.find(condition.third)?.title ?: "Неизвестный профиль мишени"
        val diameter = condition.second?.let { "${number(it / 10.0, 0)} см" } ?: "Размер не указан"
        Text("$diameter · $profile", Modifier.testTag("rank-target-conditions"), style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun RankCategoryChoice(preferences: RankPreferences) {
    var changing by rememberSaveable { mutableStateOf(false) }
    @Composable fun Choices() {
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf("male" to "Мужчины", "female" to "Женщины").forEach { (id, label) ->
                FilterChip(preferences.category == id, { preferences.onCategory(id); changing=false }, { Text(label) }, Modifier.testTag("rank-category-$id"))
            }
        }
    }
    if (preferences.category == null) {
        Text("Категория сравнения", style=MaterialTheme.typography.labelLarge)
        Choices()
    } else {
        TextButton({ changing=true }, Modifier.testTag("rank-change-category"), contentPadding=PaddingValues(0.dp),
            colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.onSurfaceVariant)) {
            androidx.compose.material3.Text("Категория: ${if (preferences.category == "male") "Мужчины" else "Женщины"}", style=MaterialTheme.typography.bodySmall)
            Spacer(Modifier.width(8.dp))
            FableIcon(Glyph.Edit, Modifier.size(16.dp))
        }
    }
    if (changing) AlertDialog(onDismissRequest={ changing=false }, title={ Text("Категория сравнения") },
        text={ Choices() }, confirmButton={ TextButton({ changing=false }) { Text("Закрыть") } })
}

@Composable
private fun RankNext(evaluation: RankEvaluation, showRemaining: Boolean) {
    evaluation.next?.let { next ->
        Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text("Следующий рубеж — ${next.label}", style=MaterialTheme.typography.titleSmall, color=LocalFableVisuals.current.information)
            Text("От ${number(next.score.toDouble() / evaluation.exercise.arrows, 2)} за стрелу · ${next.score} очков", style=MaterialTheme.typography.bodyMedium)
            if (showRemaining) evaluation.requiredRemaining(next)?.let { remaining ->
                Text(if (remaining > 10) "На оставшихся стрелах этот рубеж уже недостижим"
                    else "На оставшихся ${evaluation.exercise.arrows - evaluation.entered} стрелах нужен средний ${number(remaining, 2)}",
                    Modifier.testTag("rank-remaining"), style=MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
internal fun RankSourceHelp() {
    var open by rememberSaveable { mutableStateOf(false) }
    GlossaryText("Справочное сравнение по ЕВСК.", GlossaryRegistry.matching("ЕВСК"),
        Modifier.testTag("rank-help").clickable { open=true }, onTermClick={ open=true }, style=MaterialTheme.typography.bodySmall)
    if (open) {
        val uri = LocalUriHandler.current
        AlertDialog(onDismissRequest={ open=false }, title={ Text("О нормативах") }, text={
            Column(verticalArrangement=Arrangement.spacedBy(12.dp)) {
                androidx.compose.material3.Text(GlossaryRegistry.definitions.getValue("ЕВСК"))
                TextButton({ uri.openUri(SportRankCatalog.SOURCE) }) { androidx.compose.material3.Text("Источник · Минспорт России") }
            }
        }, confirmButton={ TextButton({ open=false }) { Text("Закрыть") } })
    }
}

private fun exerciseLabel(exercise: RankExercise): String {
    val bow = when (exercise.bow) { "barebow" -> "Баребоу"; "compound" -> "Блочный"; else -> "Классический" }
    return "$bow · ${exercise.distance} м · ${exercise.arrows} стрел"
}

@Composable
private fun RankScale(evaluation: RankEvaluation) {
    val accent = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.outlineVariant
    val motion = LocalFableVisuals.current.motion
    val average = evaluation.average
    val position by animateFloatAsState((average ?: 0.0).toFloat().coerceIn(0f, 10f) / 10f,
        tween(if (motion) 220 else 0), label = "rank average")
    var selected by remember(evaluation.exercise.id) { mutableStateOf<RankThreshold?>(null) }
    val information = LocalFableVisuals.current.information
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val background = MaterialTheme.colorScheme.surface
    val labelStyle = MaterialTheme.typography.labelSmall
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val density = androidx.compose.ui.platform.LocalDensity.current
    Column(verticalArrangement=Arrangement.spacedBy(6.dp)) {
        SlidingValue("Средний: ${average?.let { number(it, 2) } ?: "—"}", Modifier.fillMaxWidth(), style=MaterialTheme.typography.titleMedium)
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val width = constraints.maxWidth
            val inset = with(density) { 8.dp.toPx() }
            val anchors = evaluation.exercise.thresholds.map { inset + (width - inset * 2) * it.score / (evaluation.exercise.arrows * 10f) }
            val labelWidths = evaluation.exercise.thresholds.map { measurer.measure(it.label, style=labelStyle, maxLines=1).size.width + with(density) { 8.dp.roundToPx() } }
            val placements = rankLabelPlacements(anchors, labelWidths, width, with(density) { 6.dp.roundToPx() })
            val lanes = (placements.maxOfOrNull { it.lane } ?: -1) + 1
            val labelTop = 44.dp
            val laneHeight = 48.dp
            Box(Modifier.fillMaxWidth().height(labelTop + laneHeight * lanes)) {
                Canvas(Modifier.fillMaxSize().testTag("rank-scale").clearAndSetSemantics {
                    text = AnnotatedString("Шкала среднего от 0 до 10. Текущий средний ${average?.let { number(it, 2) } ?: "не определён"}")
                }) {
                    val y = 27.dp.toPx()
                    val end = size.width - inset
                    drawLine(track, Offset(inset, y), Offset(end, y), strokeWidth=4.dp.toPx())
                    placements.forEachIndexed { index, placement ->
                        val threshold = evaluation.exercise.thresholds[index]
                        val color = when (threshold) { evaluation.next -> information; evaluation.pace -> accent; else -> muted }
                        drawLine(color.copy(alpha=.5f), Offset(placement.anchor, y + 7.dp.toPx()),
                            Offset(placement.left + placement.width / 2f, labelTop.toPx() + laneHeight.toPx() * placement.lane), strokeWidth=1.dp.toPx())
                        drawLine(color, Offset(placement.anchor, y - 7.dp.toPx()), Offset(placement.anchor, y + 7.dp.toPx()), strokeWidth=2.dp.toPx())
                    }
                    if (average != null) drawCircle(accent, 6.dp.toPx(), Offset(inset + (end - inset) * position, y))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.SpaceBetween) {
                    Text("0", style=MaterialTheme.typography.labelSmall, color=muted)
                    Text("10", style=MaterialTheme.typography.labelSmall, color=muted)
                }
                placements.forEachIndexed { index, placement ->
                    val threshold = evaluation.exercise.thresholds[index]
                    val color = when (threshold) { evaluation.next -> information; evaluation.pace -> accent; else -> muted }
                    Box(Modifier.offset { androidx.compose.ui.unit.IntOffset(placement.left, with(density) { (labelTop + laneHeight * placement.lane).roundToPx() }) }
                        .width(with(density) { placement.width.toDp() }).height(laneHeight)
                        .clickable { selected=threshold }.testTag("rank-label-$index"), contentAlignment=Alignment.TopCenter) {
                        androidx.compose.material3.Text(threshold.label, Modifier.padding(top=8.dp).background(background), style=labelStyle, color=color, maxLines=1, softWrap=false)
                    }
                }
            }
        }
    }
    selected?.let { threshold ->
        AlertDialog(onDismissRequest={ selected=null }, title={ Text(threshold.label) },
            text={ Text("Порог: ${threshold.score} очков за ${evaluation.exercise.arrows} стрел — средний ${number(threshold.score.toDouble() / evaluation.exercise.arrows, 2)}.\n\n${exerciseLabel(evaluation.exercise)}") },
            confirmButton={ TextButton({ selected=null }) { Text("Закрыть") } })
    }
}
