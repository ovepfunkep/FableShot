package app.fableshot.android

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.PreferenceSwitch
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class SettingsHelpPlacementTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()

    @Test fun lockScreenQuestionFollowsLastTitleWordAtOrdinaryNarrowWidth() {
        val title="Тренировка на экране блокировки"
        val hint="После включения экрана возвращает к активной тренировке."
        var width by mutableStateOf(320.dp)
        var enabled by mutableStateOf(false)
        var pixelsPerDp=1f
        ui.setContent {
            val actual=LocalDensity.current
            pixelsPerDp=actual.density
            CompositionLocalProvider(LocalDensity provides Density(actual.density,1f)) {
                FableTheme(UserSettings(animations=false)) {
                    Box(Modifier.width(width).padding(16.dp)) {
                        PreferenceSwitch(title,hint,enabled,{enabled=it},"lock-setting")
                    }
                }
            }
        }
        fun assertAttached(expectWrapped:Boolean) {
            val layouts=mutableListOf<TextLayoutResult>()
            val label=ui.onNodeWithTag("lock-setting-title",useUnmergedTree=true)
            label.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout=layouts.single()
            if(expectWrapped)assertTrue("Fixture must exercise a wrapped title",layout.lineCount>1)
            val labelBounds=label.fetchSemanticsNode().boundsInRoot
            val lastWordEnd=layout.getBoundingBox(title.lastIndex)
            val help=ui.onNodeWithContentDescription(title,useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            val gap=help.left-(labelBounds.left+lastWordEnd.right)
            assertTrue("Question drifted from the last title word: $gap",gap>=-pixelsPerDp&&gap<=12*pixelsPerDp)
            assertEquals("Question must share the last title line",labelBounds.top+lastWordEnd.center.y,help.center.y,6*pixelsPerDp)
            val toggle=ui.onNodeWithTag("lock-setting").fetchSemanticsNode().boundsInRoot
            assertTrue("Question overlaps the separate switch",help.right<toggle.left)
        }
        assertAttached(expectWrapped=true)
        ui.runOnIdle { width=384.dp }
        assertAttached(expectWrapped=false)
        ui.onNodeWithTag("lock-setting").assertIsOff()
        ui.onNodeWithContentDescription(title,useUnmergedTree=true).performClick()
        ui.onNodeWithText(hint).assertIsDisplayed()
        ui.runOnIdle { assertFalse("Opening help must not toggle the setting",enabled) }
    }
}
