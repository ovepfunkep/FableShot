package app.fableshot.android.ui

import android.util.DisplayMetrics
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.UserSettings

/** Custom locals survive a native Compose window's platform-local replacement. */
internal val LocalAppScaleDensity = staticCompositionLocalOf<Density?> { null }

/** Android configuration and window coordinates stay unchanged; only Compose DP/SP change. */
@Composable
fun AppScale(settings: UserSettings, content: @Composable () -> Unit) {
    val system = LocalDensity.current
    val standard = remember(system.density) { standardAppDensity(system) }
    // Keep the provider in both modes, preserving remember state when switching the setting.
    // Pass through the original Density in system mode, including Android's SP conversion.
    val selected = if (settings.useSystemScale) system else standard
    CompositionLocalProvider(LocalDensity provides selected, LocalAppScaleDensity provides selected) {
        content()
    }
}

/** Restore app-owned content after Dialog/Popup creates its own AndroidComposeView. */
@Composable
internal fun AppScaleWindowContent(content: @Composable () -> Unit) {
    val selected = LocalAppScaleDensity.current ?: LocalDensity.current
    CompositionLocalProvider(LocalDensity provides selected, content = content)
}

internal fun standardAppDensity(system: Density, stableDpi: Int = DisplayMetrics.DENSITY_DEVICE_STABLE): Density {
    val density = (stableDpi.toFloat() / DisplayMetrics.DENSITY_DEFAULT)
        .takeIf { it.isFinite() && it > 0f }
        ?: system.density.takeIf { it.isFinite() && it > 0f }
        ?: 1f
    return Density(density, fontScale = 1f)
}
