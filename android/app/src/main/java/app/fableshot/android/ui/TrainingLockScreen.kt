package app.fableshot.android.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

/** Occlude keyguard only with an active training screen. Android authentication stays enabled. */
@Composable
internal fun TrainingLockScreen(enabled: Boolean) {
    val activity = LocalContext.current.activity()
    DisposableEffect(activity, enabled) {
        activity?.setShowWhenLocked(enabled)
        onDispose { if (activity?.isDestroyed == false) activity.setShowWhenLocked(false) }
    }
}

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext === this) null else baseContext.activity()
    else -> null
}
