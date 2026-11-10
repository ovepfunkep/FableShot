package app.fableshot.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import app.fableshot.android.data.StatisticFeature

val LocalStatisticsFeatures = staticCompositionLocalOf<Set<String>> { emptySet() }

@Composable
fun statisticVisible(feature: StatisticFeature): Boolean = feature.wire !in LocalStatisticsFeatures.current
