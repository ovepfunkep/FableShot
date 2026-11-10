package app.fableshot.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

internal val LocalAverageHundredths = staticCompositionLocalOf { false }

@Composable
internal fun averageNumber(value: Double): String = number(value, if (LocalAverageHundredths.current) 2 else 1)
