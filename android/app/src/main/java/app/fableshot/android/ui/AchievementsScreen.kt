package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.domain.*

@Composable
internal fun achievementColor(rarity: AchievementRarity): Color {
    val dark = MaterialTheme.colorScheme.surface.luminance() < .5f
    return when (rarity) {
        AchievementRarity.Common -> MaterialTheme.colorScheme.onSurfaceVariant
        AchievementRarity.Uncommon -> MaterialTheme.colorScheme.primary
        AchievementRarity.Rare -> Color(if (dark) 0xff9bc4ff else 0xff275da2)
        AchievementRarity.Epic -> Color(if (dark) 0xffd4b4ff else 0xff75409e)
        AchievementRarity.Legendary -> LocalFableVisuals.current.gold
        AchievementRarity.Mythic -> Color(if (dark) 0xffffb4e4 else 0xff992b70)
    }
}

internal fun achievementDate(award: EarnedAchievement): String = achievementReceivedDateLabel(award)

@Composable
fun AchievementsScreen(sessions: List<SessionSummary>, board: AchievementBoard = AchievementBoard(),
    onSession: (SessionSummary) -> Unit) {
    var selected by rememberSaveable { mutableStateOf("all") }
    var earnedOnly by rememberSaveable { mutableStateOf(false) }
    var opened by remember { mutableStateOf<List<AchievementStatus>?>(null) }
    val visible = board.statuses.filter { status ->
        (if (selected == "all") status.scope == "global" || status.scope in board.scopes || status.earned != null
            else status.scope == selected)
    }
    val families = achievementGalleryFamilies(visible).filter { !earnedOnly || it.earned.isNotEmpty() }
    LazyColumn(Modifier.fillMaxSize().testTag("achievements-screen"), contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (linkedMapOf("all" to "Все", "global" to "Общие") + achievementBowLabels).forEach { (key, label) ->
                    FilterChip(selected == key, { selected = key }, label = { Text(label) },
                        modifier = Modifier.testTag("achievement-scope-$key"))
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilterChip(!earnedOnly, { earnedOnly = false }, label = { Text("Все ступени") }, modifier = Modifier.testTag("achievements-all"))
                FilterChip(earnedOnly, { earnedOnly = true }, label = { Text("Получены") }, modifier = Modifier.testTag("achievements-earned"))
            }
        }
        if (board.failed) item { InfoCard("Не удалось загрузить достижения", "Открой коллекцию ещё раз. Дневник сохранён.") }
        else if (families.isEmpty()) item { InfoCard("Здесь начинается новая коллекция", "Награды появятся за новые тренировки. Старый дневник остаётся в статистике.") }
        items(families, key = { it.key }) { family ->
            val status = family.main
            val award = status.earned
            val tint = achievementColor(family.rarity)
            val cardColor = if (award != null) tint.copy(alpha = .08f).compositeOver(MaterialTheme.colorScheme.surface)
                else MaterialTheme.colorScheme.surface
            FableCard(Modifier.testTag("achievement-${status.definition.id}").clickable { opened = family.statuses }, color = cardColor) {
                Text(if (status.scope == "global") "Общее" else achievementBowLabels[status.scope] ?: status.scope,
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (award != null) {
                    AchievementHeading(award.title, award.rarity, family.earned.size - 1)
                    AchievementStateLabel(AchievementGalleryState.Earned,
                        "Получено · ${achievementDate(award)}", "achievement-earned-${status.definition.id}")
                    Text(award.flavor, style = MaterialTheme.typography.bodyMedium)
                }
                if (!earnedOnly) {
                    family.next?.let { next ->
                        AchievementNextStep(next, family.stateOf(next))
                    }
                    family.locked.take(2).forEach { future -> AchievementLockedSummary(future) }
                    if (family.locked.size > 2) Text("Все ступени — в подробностях",
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
    opened?.let { family -> AchievementFamilySheet(family, { opened = null }, sessions.map { it.id }.toSet()) { id -> sessions.firstOrNull { it.id == id }?.let(onSession) } }
}

@Composable
private fun AchievementStateLabel(state: AchievementGalleryState, caption: String? = null, tag: String? = null) {
    val tint = if (state == AchievementGalleryState.Locked) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when (state) {
            AchievementGalleryState.Earned -> FableIcon(Glyph.Check, Modifier.size(16.dp), tint)
            AchievementGalleryState.InProgress -> FableIcon(Glyph.Progress, Modifier.size(16.dp), tint)
            AchievementGalleryState.Next -> FableIcon(Glyph.Next, Modifier.size(16.dp), tint)
            AchievementGalleryState.Locked -> AchievementLock(tint)
        }
        val label = caption ?: when (state) {
            AchievementGalleryState.Earned -> "Получено"
            AchievementGalleryState.InProgress -> "В процессе"
            AchievementGalleryState.Next -> "Следующая ступень"
            AchievementGalleryState.Locked -> "Закрыто · позже"
        }
        Text(label, if (tag == null) Modifier else Modifier.testTag(tag), color = tint, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun AchievementProgress(status: AchievementStatus) {
    val target = status.definition.target.coerceAtLeast(1)
    val value = status.value.coerceIn(0, target)
    Text("Прогресс: $value / $target", style = MaterialTheme.typography.bodySmall)
    LinearProgressIndicator(progress = { (value.toFloat() / target).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun AchievementNextStep(status: AchievementStatus, state: AchievementGalleryState) {
    Surface(Modifier.fillMaxWidth().testTag("achievement-next-${status.definition.id}"),
        shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AchievementStateLabel(state, if (state == AchievementGalleryState.InProgress) "Следующая ступень · В процессе" else null)
            AchievementHeading(status.definition.title, status.definition.rarityFor(status.scope))
            Text(achievementDescriptionForDisplay(status.definition.description), style = MaterialTheme.typography.bodySmall,
                maxLines = 3, overflow = TextOverflow.Ellipsis)
            AchievementProgress(status)
        }
    }
}

@Composable
private fun AchievementLockedSummary(status: AchievementStatus) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().testTag("achievement-locked-${status.definition.id}"),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        AchievementLock(tint)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(status.definition.title, color = tint, style = MaterialTheme.typography.bodyMedium)
            Text("Закрыто · позже · ${status.definition.rarityFor(status.scope).label}", color = tint,
                style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun AchievementLock(tint: Color) {
    Canvas(Modifier.size(18.dp)) {
        val line = Stroke(1.6.dp.toPx())
        drawArc(tint, 180f, 180f, false, Offset(size.width * .28f, size.height * .12f),
            Size(size.width * .44f, size.height * .48f), style = line)
        drawRoundRect(tint, Offset(size.width * .16f, size.height * .43f), Size(size.width * .68f, size.height * .48f),
            androidx.compose.ui.geometry.CornerRadius(2.dp.toPx()), style = line)
    }
}

@Composable
internal fun AchievementHeading(title: String, rarity: AchievementRarity, additional: Int = 0, scope: String? = null) {
    val tint = achievementColor(rarity)
    val scopeLabel = when (scope) {
        null -> null
        "global" -> "Общее"
        else -> achievementBowLabels[scope] ?: scope
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        FableIcon(Glyph.Trophy, tint = tint)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(listOfNotNull(rarity.label, scopeLabel).joinToString(" · "), color = tint, style = MaterialTheme.typography.labelSmall)
        }
        if (additional > 0) Text("+$additional", Modifier.testTag("achievement-additional"), color = tint, style = MaterialTheme.typography.titleMedium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AchievementFamilySheet(statuses: List<AchievementStatus>, onDismiss: () -> Unit,
    availableSessionIds: Set<String>? = null, onSession: ((String) -> Unit)? = null) {
    val families = achievementGalleryFamilies(statuses)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(Modifier.fillMaxWidth().testTag("achievement-details"), contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Достижения", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    IconButton(onDismiss, Modifier.testTag("achievement-details-close")) {
                        FableIcon(Glyph.Close, description = "Закрыть достижения")
                    }
                }
            }
            families.forEach { family ->
                val main = family.main
                item(key = "group:${main.key}") {
                    Column(Modifier.testTag("achievement-detail-group-${family.key}"),
                        verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        AchievementHeading(main.earned?.title ?: main.definition.title,
                            main.earned?.rarity ?: main.definition.rarityFor(main.scope),
                            (family.earned.size - 1).coerceAtLeast(0))
                        Text(if (main.scope == "global") "Общее" else achievementBowLabels[main.scope] ?: main.scope,
                            style = MaterialTheme.typography.labelSmall)
                    }
                }
                items(family.details, key = { it.key }) { status ->
                    val state = family.stateOf(status)
                    val isNext = state == AchievementGalleryState.Next || state == AchievementGalleryState.InProgress
                    Surface(Modifier.fillMaxWidth().testTag("achievement-detail-${status.definition.id}"),
                        color = if (state == AchievementGalleryState.Earned) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(16.dp),
                        border = if (isNext) BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary) else null) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state == AchievementGalleryState.Locked) AchievementLockedSummary(status)
                            else if (status != main) AchievementHeading(status.earned?.title ?: status.definition.title,
                                status.earned?.rarity ?: status.definition.rarityFor(status.scope))
                            val award = status.earned
                            if (award != null) {
                                AchievementStateLabel(state, "Получено · ${achievementEarnedMoment(award)}",
                                    "achievement-moment-${status.definition.id}")
                            } else if (state != AchievementGalleryState.Locked) AchievementStateLabel(state)
                            val contentColor = if (state == AchievementGalleryState.Locked) MaterialTheme.colorScheme.onSurfaceVariant
                                else MaterialTheme.colorScheme.onSurface
                            Text(status.earned?.flavor ?: status.definition.flavor, color = contentColor)
                            Text(achievementDescriptionForDisplay(status.earned?.description ?: status.definition.description),
                                color = contentColor, style = MaterialTheme.typography.bodyMedium)
                            if (isNext) AchievementProgress(status)
                            if (award != null) {
                                award.sessionId?.takeIf { onSession != null && (availableSessionIds == null || it in availableSessionIds) }?.let { id ->
                                    TextButton({ onDismiss(); onSession?.invoke(id) }, Modifier.testTag("achievement-source-${award.ruleId}")) { Text("Открыть тренировку") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

internal fun awardStatuses(awards: List<EarnedAchievement>) = awards.map { award ->
    val definition = AchievementCatalog.byId[award.ruleId] ?: AchievementDefinition(award.ruleId, award.title,
        award.flavor, award.description, award.family, award.rarity, priority = award.priority)
    AchievementStatus(definition.copy(title = award.title, flavor = award.flavor, description = award.description,
        family = award.family, priority = award.priority), award.scope, definition.target, award)
}

@Composable
fun ProfileAchievementsCard(sessions: List<SessionSummary>, onOpen: () -> Unit, showEarned: Boolean = true,
    board: AchievementBoard = AchievementBoard()) {
    var opened by remember { mutableStateOf<AchievementGroup?>(null) }
    val groups = remember(board.awards) { groupAchievements(board.awards) }
    FableCard(Modifier.testTag("profile-achievements"), geometry = GeometryPattern.Cluster) {
        BlockHeading("Достижения", Glyph.Trophy)
        if (board.failed) Text("Не удалось загрузить коллекцию")
        else if (showEarned && groups.isNotEmpty()) Column(Modifier.testTag("profile-achievements-list"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            groups.take(4).forEach { group ->
                Row(Modifier.fillMaxWidth().clickable { opened = group }.padding(vertical = 4.dp)) {
                    AchievementHeading(group.main.title, group.main.rarity, group.others.size, scope = group.main.scope)
                }
            }
        }
        else if (showEarned) Text("Пока нет полученных", style = MaterialTheme.typography.bodyMedium)
        TextButton(onOpen, Modifier.testTag("profile-achievements-open"),
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant)) { Text("Все достижения") }
    }
    opened?.let { group -> AchievementFamilySheet(awardStatuses(listOf(group.main) + group.others), { opened = null }) }
}

@Composable
fun TrainingAchievementsCard(awards: List<EarnedAchievement>, onSession: ((String) -> Unit)? = null) {
    val groups = remember(awards) { groupAchievements(awards) }
    var opened by remember { mutableStateOf<AchievementGroup?>(null) }
    if (groups.isEmpty()) return
    FableCard(Modifier.testTag("training-achievements"), geometry = GeometryPattern.Constellation) {
        BlockHeading("Достижения этой тренировки", Glyph.Trophy)
        groups.forEach { group ->
            Row(Modifier.fillMaxWidth().clickable { opened = group }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                AchievementHeading(group.main.title, group.main.rarity, group.others.size, scope = group.main.scope)
            }
        }
    }
    opened?.let { group -> AchievementFamilySheet(awardStatuses(listOf(group.main) + group.others), { opened = null }, onSession = onSession) }
}
