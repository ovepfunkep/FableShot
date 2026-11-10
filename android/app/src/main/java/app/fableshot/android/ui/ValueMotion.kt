package app.fableshot.android.ui

import androidx.compose.runtime.withFrameNanos

internal const val VALUE_MOTION_MILLIS = 220

/** Let the value finish in this frame clock before introducing a second animated window. */
internal suspend fun awaitValueMotion() {
    val firstFrame = withFrameNanos { it }
    val duration = VALUE_MOTION_MILLIS * 1_000_000L
    while (withFrameNanos { it } - firstFrame < duration) { /* suspend until the next frame */ }
}
