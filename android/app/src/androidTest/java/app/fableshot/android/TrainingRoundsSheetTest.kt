package app.fableshot.android

import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import app.fableshot.android.data.UserSettings
import app.fableshot.android.data.journal.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class TrainingRoundsSheetTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()

    @Test fun roundListOpensSeriesAndRequiresConfirmationBeforeEarlyTransition() {
        val session=JournalSession("round-session","Fixture",1,1)
        val block=JournalBlock("round-block",session.id,0,"scored",18.0,PRACTICE_PROFILE,1,400,practiceSnapshot(400),null,3)
        val end=JournalEnd("first-end",block.id,0,3)
        val details=mutableStateOf(JournalDetails(session,listOf(JournalBlockDetails(block,
            listOf(JournalEndDetails(end,emptyList(),emptyList())))),listOf(SessionPlan(session.id,10,rolling=true))))
        var starts=0
        var selected:String?=null
        ui.setContent { FableTheme(UserSettings(animations=false)) {
            TrainingRoundsSheet(details.value,false,{}, {selected=it},{starts++})
        } }
        ui.onNodeWithTag("start-new-round").assertIsNotEnabled()
        ui.runOnIdle {
            val shot=JournalShot("shot",end.id,0,10,"10",null,null,.01,.01,"main","target_computed","manual_target","known",null,1)
            details.value=details.value.copy(blocks=listOf(JournalBlockDetails(block,
                listOf(JournalEndDetails(end,listOf(shot),emptyList())))))
        }
        ui.onNodeWithTag("training-round-1").performClick()
        assertEquals(end.id,selected)
        ui.onNodeWithTag("start-new-round").performClick()
        assertEquals(0,starts)
        ui.onNodeWithText("Отмена").performClick()
        assertEquals(0,starts)
        ui.onNodeWithTag("start-new-round").performClick()
        ui.onNodeWithTag("confirm-new-round").performClick()
        assertEquals(1,starts)
    }

    @Test fun seriesSelectorUsesTheViewedRoundAndBlocksSelectionDuringSaveAtLargeFont() {
        val session = JournalSession("series-session", "Fixture", 1, 1)
        val block = JournalBlock("series-block", session.id, 0, "scored", 18.0,
            PRACTICE_PROFILE, 1, 400, practiceSnapshot(400), null, 3)
        val ends = (0..2).map { index ->
            val end = JournalEnd("series-end-$index", block.id, index, 3, state = "closed")
            val shot = JournalShot("series-shot-$index", end.id, 0, index + 7, "${index + 7}",
                null, null, .1, .1, "main", "target_computed", "manual_target", "known", null, 1)
            JournalEndDetails(end, listOf(shot), emptyList())
        }
        val details = JournalDetails(session, listOf(JournalBlockDetails(block, ends)),
            listOf(SessionPlan(session.id, 2, rolling = true)))
        val busy = mutableStateOf(true)
        var selected: String? = null
        var dismissals = 0
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                AppScale(UserSettings(useSystemScale = true)) {
                    FableTheme(UserSettings(animations = false)) {
                        TrainingSeriesSheet(details, ends.first().end.id, busy.value,
                            { dismissals++ }, { selected = it })
                    }
                }
            }
        }
        ui.onNodeWithText("Серии · раунд 1").assertIsDisplayed()
        ui.onNodeWithTag("training-select-series-1").assertIsNotEnabled()
        ui.onNodeWithTag("training-select-series-2").assertIsNotEnabled()
        ui.onNodeWithTag("training-select-series-3").assertDoesNotExist()
        ui.runOnIdle { busy.value = false }
        ui.onNodeWithTag("training-select-series-2").performScrollTo().assertIsEnabled().performClick()
        ui.runOnIdle {
            assertEquals(ends[1].end.id, selected)
            assertEquals(1, dismissals)
        }
    }

    @Test fun hiddenScoresStayHiddenInBothSelectorsWhileSelectionRemainsAvailable() {
        val session = JournalSession("hidden-selector-session", "Fixture", 1, 1)
        val block = JournalBlock("hidden-selector-block", session.id, 0, "scored", 18.0,
            PRACTICE_PROFILE, 1, 400, practiceSnapshot(400), null, 3)
        val end = JournalEnd("hidden-selector-end", block.id, 0, 3)
        val shot = JournalShot("hidden-selector-shot", end.id, 0, 9, "9", null, null,
            .1, .1, "main", "target_computed", "manual_target", "known", null, 1)
        val details = JournalDetails(session, listOf(JournalBlockDetails(block,
            listOf(JournalEndDetails(end, listOf(shot), emptyList())))),
            listOf(SessionPlan(session.id, 10, rolling = true)))
        val roundSelector = mutableStateOf(true)
        val hidden = mutableStateOf(false)
        var selections = 0
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                if (roundSelector.value) TrainingRoundsSheet(details, false, {}, { selections++ }, {},
                    hideScores = hidden.value)
                else TrainingSeriesSheet(details, end.id, false, {}, { selections++ },
                    hideScores = hidden.value)
            }
        }
        for (round in listOf(true, false)) {
            ui.runOnIdle { roundSelector.value = round; hidden.value = false }
            ui.onNodeWithText("очков", substring = true).assertExists()
            ui.onNodeWithText("9,0", substring = true).assertExists()
            ui.runOnIdle { hidden.value = true }
            ui.onNodeWithText("очков", substring = true).assertDoesNotExist()
            ui.onNodeWithText("9,0", substring = true).assertDoesNotExist()
            val selectedBefore = selections
            ui.onNodeWithTag(if (round) "training-round-1" else "training-select-series-1")
                .assertIsEnabled().performClick()
            ui.runOnIdle { assertEquals(selectedBefore + 1, selections) }
        }
    }
}
