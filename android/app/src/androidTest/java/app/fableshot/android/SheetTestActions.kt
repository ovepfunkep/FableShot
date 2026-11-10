package app.fableshot.android

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeContentTestRule

/** Exercise the sheet's accessible dismiss gesture without privileged key injection. */
internal fun dismissTestSheet(ui: ComposeContentTestRule) {
    ui.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss), useUnmergedTree = true)
        .onLast().performSemanticsAction(SemanticsActions.Dismiss) { it() }
    ui.waitForIdle()
}
