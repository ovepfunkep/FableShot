package app.fableshot.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fableshot.android.R
import app.fableshot.android.data.*

@Composable
fun SettingsScreen(settings: UserSettings, onStyle: (DesignStyle)->Unit, onAppearance: (Appearance)->Unit, onAnimations:(Boolean)->Unit, onHaptics:(Boolean)->Unit, onAwake:(Boolean)->Unit, onWelcome:()->Unit, onTutorial:()->Unit,onArchive:(()->Unit)?=null, onImport:(()->Unit)?=null, onTechnique:(()->Unit)?=null, onTrash:(()->Unit)?=null,onHideScores:((Boolean)->Unit)?=null,onAchievements:((Boolean)->Unit)?=null,diaries:app.fableshot.android.backup.DiaryManager?=null,canReset:Boolean=true,
    onStatistic: ((StatisticFeature, Boolean) -> Unit)? = null, onStatisticsReset: (() -> Unit)? = null,
    onSystemScale: ((Boolean) -> Unit)? = null,
    onAverageHundredths: ((Boolean) -> Unit)? = null,
    onTrainingOnLockScreen: ((Boolean) -> Unit)? = null,
) {
    var section by rememberSaveable { mutableStateOf<String?>(null) }
    var resetBusy by remember { mutableStateOf(false) }
    var releaseHistory by rememberSaveable { mutableStateOf(false) }
    androidx.activity.compose.BackHandler(section != null) { section = null }
    Column(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(20.dp).testTag("settings-screen"),verticalArrangement=Arrangement.spacedBy(20.dp)) content@{
        if (section == null) {
            SettingsEntry("Оформление", Glyph.Spark) { section = "appearance" }
            SettingsEntry("Движение и отклик", Glyph.Settings) { section = "motion" }
            SettingsEntry("Тренировка", Glyph.Target) { section = "training" }
            if (onStatistic != null) SettingsEntry("Статистика", Glyph.Progress) { section = "statistics" }
            SettingsEntry("Данные и перенос", Glyph.Download) { section = "data" }
            SettingsEntry("Помощь", Glyph.Help) { section = "help" }
            return@content
        }
        if (section == "statistics") {
            SectionHeading("Статистика", icon = Glyph.Progress)
            if (onAverageHundredths != null) PreferenceSwitch("Средний балл до сотых",
                "Два знака после запятой вместо одного. Точность расчётов не меняется.",
                settings.averageHundredths, onAverageHundredths, "setting-average-hundredths")
            Text("Выбери показатели и графики, которые хочешь видеть.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val hidden = StatisticFeature.entries.filter { it.wire in settings.disabledStatistics }
            TextButton(
                onClick = {
                    if (onStatisticsReset != null) onStatisticsReset()
                    else hidden.forEach { onStatistic?.invoke(it, true) }
                },
                enabled = hidden.isNotEmpty() && onStatistic != null,
                modifier = Modifier.testTag("statistics-enable-all"),
            ) { Text("Показывать всё") }
            StatisticSection.entries.forEach { group ->
                FableCard {
                    Text(group.title, style = MaterialTheme.typography.titleMedium)
                    StatisticFeature.entries.filter { it.section == group }.forEach { feature ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(feature.title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                            Switch(
                                checked = feature.wire !in settings.disabledStatistics,
                                onCheckedChange = { visible -> onStatistic?.invoke(feature, visible) },
                                enabled = onStatistic != null,
                                modifier = Modifier.testTag("statistic-${feature.wire}"),
                            )
                        }
                    }
                }
            }
        }
        if (section == "appearance") {
        Column(verticalArrangement=Arrangement.spacedBy(6.dp)) { Text(stringResource(R.string.appearance_title),style=MaterialTheme.typography.headlineLarge);Text(stringResource(R.string.appearance_description), style=MaterialTheme.typography.bodyMedium, color=MaterialTheme.colorScheme.onSurfaceVariant) }
        DesignStyle.entries.forEach { style ->
            val label=when(style){DesignStyle.Sport->R.string.style_sport;DesignStyle.Pop->R.string.style_pop;DesignStyle.Minimal->R.string.style_minimal}
            val color=when(style){DesignStyle.Sport->Color(0xFFC6F43D);DesignStyle.Pop->Color(0xFFC2A0FF);DesignStyle.Minimal->Color(0xFF4D86F7)}
            Surface(onClick={onStyle(style)},modifier=Modifier.fillMaxWidth().testTag("style-${style.wire}"),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,border=BorderStroke(if(settings.style==style)2.dp else 1.dp,if(settings.style==style)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) {
                Row(Modifier.padding(18.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.size(56.dp,40.dp).background(color,RoundedCornerShape(if(style==DesignStyle.Pop)18.dp else 10.dp)),contentAlignment=Alignment.Center) { FableIcon(Glyph.Arrow,tint=Color(0xFF172419)) }
                    Text(stringResource(label),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                    if(settings.style==style) FableIcon(Glyph.Check,tint=MaterialTheme.colorScheme.primary,description=stringResource(R.string.done))
                }
            }
        }
        Eyebrow(stringResource(R.string.appearance_mode))
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
            Appearance.entries.forEach { appearance ->
                val label=when(appearance){Appearance.System->R.string.mode_system;Appearance.Light->R.string.mode_light;Appearance.Dark->R.string.mode_dark}
                FilterChip(settings.appearance==appearance,{onAppearance(appearance)},{Text(stringResource(label),style=MaterialTheme.typography.labelMedium)},modifier=Modifier.weight(1f).heightIn(min=48.dp).testTag("appearance-${appearance.wire}"))
            }
        }
        if (onSystemScale != null) FableCard {
            PreferenceSwitch("Системный масштаб",
                "Учитывает размер текста и интерфейса Android. При увеличении на экране помещается меньше данных.",
                settings.useSystemScale, onSystemScale, "setting-system-scale")
        }
        }
        if (section == "motion" || section == "training") {
        SectionHeading(if (section == "motion") "Движение и отклик" else "Тренировка",icon=if(section=="motion")Glyph.Spark else Glyph.Target)
        FableCard {
            if (section == "motion") PreferenceSwitch(stringResource(R.string.animations_title),stringResource(R.string.animations_hint),settings.animations,onAnimations,"setting-animations")
            if (section == "motion") PreferenceSwitch(stringResource(R.string.haptics_title),stringResource(R.string.haptics_hint),settings.haptics,onHaptics,"setting-haptics")
            if (section == "motion" && onAchievements != null) PreferenceSwitch("Показывать достижения", "Скрывает полученные достижения в профиле. Вход в полную коллекцию остаётся в этом же блоке. Обычная статистика и рекорды остаются доступны; штрафов за пропуски нет.", settings.showAchievements, onAchievements, "setting-achievements")
            if (section == "training") PreferenceSwitch(stringResource(R.string.awake_title),stringResource(R.string.awake_hint),settings.keepAwake,onAwake,"setting-awake")
            if (section == "training" && onTrainingOnLockScreen != null) PreferenceSwitch(
                "Тренировка на экране блокировки",
                "После включения экрана возвращает к активной тренировке. Для выхода к другим приложениям по-прежнему нужна разблокировка телефона.",
                settings.trainingOnLockScreen, onTrainingOnLockScreen, "setting-training-lock-screen")
            if (section == "training" && onHideScores != null) ScoreVisibilityPreference(settings.hideCurrentScores, onHideScores)
        }
        }
        if (section == "data") {
        SectionHeading("Данные и перенос",icon=Glyph.Archive)
        if (onImport != null) {
            FablePrimaryButton(stringResource(R.string.import_open_label), onImport, Modifier.fillMaxWidth().testTag("open-import"), icon = Glyph.Download, enabled = !resetBusy)

        }
        if(onArchive!=null)FablePrimaryButton(stringResource(R.string.archive_title),onArchive,Modifier.fillMaxWidth().testTag("open-archive"),enabled=!resetBusy)
        if (diaries != null) {
            AchievementResetCard(diaries, canReset && !resetBusy, onBusy = { resetBusy = it })
            AccountResetCard(diaries, canReset && !resetBusy, onBusy = { resetBusy = it })
        }
        }
        if (section == "help") {
        SectionHeading("Помощь",icon=Glyph.Help)
        FablePrimaryButton(stringResource(R.string.app_introduction),onWelcome,Modifier.fillMaxWidth(),icon=Glyph.Book)
        FablePrimaryButton(stringResource(R.string.target_introduction),onTutorial,Modifier.fillMaxWidth().testTag("help-tutorial"),icon=Glyph.Question)
        }
        Spacer(Modifier.height(12.dp))
    }
    if (section == null) ReleaseVersionStrip { releaseHistory = true }
    }
    if (releaseHistory) ReleaseNotesSheet(
        AppReleases.entries,
        onDismiss = { releaseHistory = false },
        fullHistory = true,
    )
}

@Composable
internal fun ScoreVisibilityPreference(checked: Boolean, onChange: (Boolean) -> Unit) {
    PreferenceSwitch("Скрывать очки", "Для интриги и большего места под мишень: убирает оценки стрел, суммы, средние и прогноз разряда вместе с их подписями. Номера стрел, лупа и правка остаются. Эффекты десяток выключены. Результаты можно открыть в статистике; после завершения они видны в отчёте. Попадания сохраняются как обычно.",
        checked, onChange, "setting-hide-scores")
}

@Composable
internal fun PreferenceSwitch(title:String,hint:String,checked:Boolean,onChange:(Boolean)->Unit,tag:String) {
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
        val label=buildAnnotatedString {
            append(title)
            // Keep the question attached to the last word when the title wraps.
            append('\u00A0')
            appendInlineContent("preference-help")
        }
        Text(label,Modifier.weight(1f).testTag("$tag-title"),style=MaterialTheme.typography.titleSmall,
            inlineContent=mapOf("preference-help" to InlineTextContent(
                Placeholder(24.sp,24.sp,PlaceholderVerticalAlign.Center),
            ) { HelpButton(title,hint,iconOnly=true) }))
        Switch(checked,onChange,modifier=Modifier.testTag(tag))
    }
}

@Composable
private fun SettingsEntry(title: String, icon: Glyph, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            FableIcon(icon)
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
            FableIcon(Glyph.Next)
        }
    }
}
