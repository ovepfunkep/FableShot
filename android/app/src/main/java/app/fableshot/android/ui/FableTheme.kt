package app.fableshot.android.ui

import android.animation.ValueAnimator
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.unit.*
import app.fableshot.android.R
import app.fableshot.android.data.*

@Immutable
data class FableVisuals(
    val action: Color,
    val onAction: Color,
    val information: Color,
    val gold: Color,
    val cardRadius: Dp,
    val motion: Boolean,
    val style: DesignStyle = DesignStyle.Sport,
)
val LocalFableVisuals = staticCompositionLocalOf { FableVisuals(Color(0xFFC6F43D), Color(0xFF18210C), Color(0xFF14758A), Color(0xFFAD7610), 24.dp, true) }

private val Manrope = FontFamily(
    Font(R.font.manrope_400,FontWeight.Normal),Font(R.font.manrope_500,FontWeight.Medium),
    Font(R.font.manrope_600,FontWeight.SemiBold),Font(R.font.manrope_700,FontWeight.Bold),Font(R.font.manrope_800,FontWeight.ExtraBold),
)
private fun type(size: Int, height: Int, weight: Int = 400, spacing: Float = 0f) = TextStyle(
    fontFamily = Manrope, fontSize = size.sp, lineHeight = height.sp, fontWeight = FontWeight(weight),
    letterSpacing = spacing.sp, fontFeatureSettings = "tnum",
)
private val FableTypography = Typography(
    displayLarge = type(56, 60, 800, -2f), displayMedium = type(46, 52, 800, -1.6f), displaySmall = type(38, 44, 800, -1.1f),
    headlineLarge = type(32, 38, 800, -1f), headlineMedium = type(28, 34, 800, -.7f), headlineSmall = type(24, 30, 700, -.5f),
    titleLarge = type(20, 26, 700, -.3f), titleMedium = type(16, 22, 700), titleSmall = type(14, 20, 700),
    bodyLarge = type(16, 25), bodyMedium = type(14, 22), bodySmall = type(12, 18),
    labelLarge = type(14, 20, 700), labelMedium = type(12, 16, 600, .2f), labelSmall = type(10, 14, 700, .7f),
)

@Composable
fun FableTheme(settings: UserSettings = UserSettings(), content: @Composable () -> Unit) {
    val dark = when (settings.appearance) { Appearance.System -> isSystemInDarkTheme(); Appearance.Dark -> true; Appearance.Light -> false }
    val style = settings.style
    val primary = when (style) {
        DesignStyle.Sport -> if (dark) Color(0xFFC6F43D) else Color(0xFF496411)
        DesignStyle.Pop -> if (dark) Color(0xFFCEB2FF) else Color(0xFF6033AC)
        DesignStyle.Minimal -> if (dark) Color(0xFF9CBDFF) else Color(0xFF195BE7)
    }
    val action = when (style) { DesignStyle.Sport -> Color(0xFFC6F43D); DesignStyle.Pop -> if (dark) Color(0xFFCAABFF) else Color(0xFF6033AC); DesignStyle.Minimal -> if (dark) Color(0xFF91B5FF) else Color(0xFF195BE7) }
    val onAction = if (style == DesignStyle.Sport || dark) Color(0xFF14200D) else Color.White
    val background = when (style) { DesignStyle.Sport -> if (dark) 0xFF101610 else 0xFFF4F6F1; DesignStyle.Pop -> if (dark) 0xFF181023 else 0xFFFAF6FF; DesignStyle.Minimal -> if (dark) 0xFF0D131E else 0xFFF7F9FC }
    val surface = when (style) { DesignStyle.Sport -> if (dark) 0xFF1A231C else 0xFFFFFFFF; DesignStyle.Pop -> if (dark) 0xFF291D39 else 0xFFFFFFFF; DesignStyle.Minimal -> if (dark) 0xFF182131 else 0xFFFFFFFF }
    val variant = when (style) { DesignStyle.Sport -> if (dark) 0xFF263129 else 0xFFE9EEE3; DesignStyle.Pop -> if (dark) 0xFF3A294C else 0xFFF0E7FC; DesignStyle.Minimal -> if (dark) 0xFF233046 else 0xFFECF1F8 }
    val ink = if (dark) Color(0xFFF2F6ED) else Color(0xFF17221B)
    val muted = if (dark) Color(0xFFB1BCAF) else Color(0xFF59675C)
    val info = if (dark) Color(0xFF8DD7EA) else Color(0xFF176A80)
    val border = if (dark) Color(0xFF3D4B40) else Color(0xFFD7DFD4)
    val colors = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = primary, onPrimary = if (dark) Color(0xFF17220D) else Color.White,
        primaryContainer = action, onPrimaryContainer = onAction,
        secondary = info, onSecondary = if (dark) Color(0xFF00303B) else Color.White,
        secondaryContainer = Color(variant), onSecondaryContainer = ink,
        tertiary = if (dark) Color(0xFFFFD882) else Color(0xFF8D5E00),
        background = Color(background), onBackground = ink, surface = Color(surface), onSurface = ink,
        surfaceVariant = Color(variant), onSurfaceVariant = muted,
        surfaceContainer = Color(surface), surfaceContainerLow = Color(background), surfaceContainerHigh = Color(variant),
        outline = border, outlineVariant = border.copy(alpha = .65f), inverseSurface = ink, inverseOnSurface = Color(background),
    )
    val radius = when (style) { DesignStyle.Sport -> 24.dp; DesignStyle.Pop -> 28.dp; DesignStyle.Minimal -> 18.dp }
    val visuals = FableVisuals(action, onAction, info, if (dark) Color(0xFFFFD882) else Color(0xFF966500), radius, settings.animations && ValueAnimator.areAnimatorsEnabled(), style)
    CompositionLocalProvider(
        LocalFableVisuals provides visuals,
        LocalStatisticsFeatures provides settings.disabledStatistics,
        LocalAverageHundredths provides settings.averageHundredths,
    ) {
        MaterialTheme(colors, Shapes(small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(18.dp), large = RoundedCornerShape(radius), extraLarge = RoundedCornerShape(radius + 4.dp)), FableTypography, content)
    }
}
