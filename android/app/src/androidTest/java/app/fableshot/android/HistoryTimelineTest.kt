package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import app.fableshot.android.data.JournalSummaryMeta
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.ZoneId

/** In-memory presentation fixtures only. This class never opens a diary or DataStore. */
class HistoryTimelineTest {
    @get:Rule val ui = createAndroidComposeRule<VerificationActivity>()

    private fun session(id: String, day: String?, title: String = "Тренировка $id", recordedYear: Int = 2035): SessionSummary {
        val recorded = LocalDate.of(recordedYear, 1, 1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        return SessionSummary(id, title, recorded, "completed", 12, 108, 18.0, 400, "practice-full-10-v1",
            JournalSummaryMeta(1, 12, true, false, localDate = day, dateKnown = day != null,
                progressPercentagePoints = 2.5, progressReady = true,
                progressBaselineAverage = 8.0, progressCurrentAverage = 8.25, progressSourceCount = 5))
    }

    private fun show(tag: String) {
        ui.onNodeWithTag("history-screen").performScrollToNode(hasTestTag(tag))
        ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
    }

    @Test fun chronologyUsesSavedTrainingDateAndStableIdWithUnknownDatesLast() {
        val old = session("old", "2025-12-31", recordedYear = 2040)
        val later = session("later", "2026-01-02", recordedYear = 2000)
        val sameB = session("b", "2026-01-01")
        val sameA = session("a", "2026-01-01")
        val unknown = session("unknown", null, recordedYear = 2050)
        val input = listOf(old, sameB, unknown, later, sameA)
        val timeline = historyTimelineItems(input)
        val rows = timeline.filterIsInstance<HistoryTimelineItem.Session>()
        assertEquals(listOf("later", "a", "b", "old", "unknown"), rows.map { it.value.id })
        assertEquals(timeline, historyTimelineItems(input.reversed()))
        assertEquals(listOf("history-year-2026", "history-month-2026-01", "history-row-later",
            "history-row-a", "history-row-b", "history-year-2025", "history-month-2025-12", "history-row-old",
            "history-unknown-dates", "history-row-unknown"), timeline.map { it.key })
        assertNull(historyTrainingDate(unknown))
        assertNull(historyTrainingDate(old.copy(journalMeta = old.journalMeta!!.copy(localDate = "invalid"))))
        val legacy = later.copy(journalMeta = null)
        assertEquals(LocalDate.of(2000, 1, 1), historyTrainingDate(legacy))
    }

    @Test fun nativeSessionsOnTheSameDayUseStartTimeWhileUnrelatedImportTimesStayOut() {
        val day = LocalDate.of(2026, 11, 4)
        fun native(id: String, hour: Int) = session(id, day.toString()).copy(
            startedAt = day.atTime(hour, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli())
        val early = native("a-early", 10)
        val late = native("z-late", 18)
        val sameDayImport = session("b-import", day.toString(), recordedYear = 2050)
        val sameDayUnknownTime = session("a-import", day.toString(), recordedYear = 2040)
        val olderImport = session("older-import", "2026-11-03", recordedYear = 2060)
        val input = listOf(early, sameDayImport, olderImport, late, sameDayUnknownTime)
        val rows = historyTimelineItems(input).filterIsInstance<HistoryTimelineItem.Session>()
        assertEquals(listOf("z-late", "a-early", "a-import", "b-import", "older-import"), rows.map { it.value.id })
        assertEquals(historyTimelineItems(input), historyTimelineItems(input.reversed()))
    }

    @Test fun searchKeepsMonthYearAndExternalDateWhileCardStillOpens() {
        val newest = session("newest", "2027-01-05", "Январская тренировка", recordedYear = 2000)
        val older = session("older", "2026-12-30", "Декабрьская тренировка")
        val unknown = session("unknown", null, "Без даты")
        var opened: String? = null
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { HistoryScreen(listOf(unknown, older, newest), { opened = it.id }, {}) }
            }
        }
        show("history-up-arrow")
        ui.onNodeWithTag("history-year-2027").assertExists()
        ui.onNodeWithTag("history-month-2027-01").assertExists()
        show("session-newest")
        ui.onNodeWithTag("session-date-newest", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("history-day-newest", useUnmergedTree = true).assertTextEquals("5")
        ui.onNodeWithTag("history-date-circle-newest").assertExists()
        ui.onNodeWithTag("session-average-newest", useUnmergedTree = true).assertExists()
        ui.onNodeWithTag("session-progress-newest", useUnmergedTree = true).assertExists()
        ui.onNodeWithTag("session-newest").performClick()
        assertEquals(newest.id, opened)
        show("history-search")
        ui.onNodeWithTag("history-search").performTextReplacement("Декабрьская")
        show("history-year-2026")
        ui.onNodeWithTag("history-month-2026-12").assertTextEquals("Декабрь")
        ui.onNodeWithTag("history-year-2027").assertDoesNotExist()
        show("session-older")
        ui.onNodeWithTag("session-older").performClick()
        assertEquals(older.id, opened)
        capture("history-normal.png")
        show("history-search")
        ui.onNodeWithTag("history-search").performTextReplacement("Без даты")
        show("history-unknown-dates")
        ui.onNodeWithTag("history-unknown-dates").assertTextEquals("Дата не указана")
        ui.onNodeWithTag("history-year-2026").assertDoesNotExist()
        show("session-unknown")
        ui.onNodeWithTag("history-day-unknown", useUnmergedTree = true).assertTextEquals("—")
    }

    @Test fun periodFilterUsesTrainingDateAndDropsUndatedRows() {
        val today = LocalDate.now()
        val current = session("today", today.toString(), recordedYear = 2000)
        val old = session("old", today.minusMonths(2).toString(), recordedYear = 2040)
        val unknown = session("unknown", null)
        ui.setContent {
            FableTheme(UserSettings(animations = false)) {
                Surface { HistoryScreen(listOf(old, unknown, current), {}, {}) }
            }
        }
        ui.onNodeWithTag("history-filters").performClick()
        ui.onNodeWithText(ui.activity.getString(R.string.period_week)).performScrollTo().performClick()
        show("session-today")
        ui.onNodeWithTag("history-year-${today.year}").assertExists()
        ui.onNodeWithTag("history-month-${java.time.YearMonth.from(today)}").assertExists()
        ui.onNodeWithTag("session-old").assertDoesNotExist()
        ui.onNodeWithTag("session-unknown").assertDoesNotExist()
        ui.onNodeWithTag("history-unknown-dates").assertDoesNotExist()
    }

    @Test fun deletedTimelinePreservesDetailsAndRestoresAtLargeFont() {
        val removed = session("removed", "2026-11-04", "Удалённая тренировка с длинным названием")
        val history = mutableStateOf(emptyList<SessionSummary>())
        val trash = mutableStateOf(listOf(removed))
        ui.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                FableTheme(UserSettings(animations = false)) {
                    Surface {
                        HistoryScreen(history.value, {}, {}, trash.value, initiallyDeleted = true, onRestore = {
                            history.value = listOf(removed)
                            trash.value = emptyList()
                        })
                    }
                }
            }
        }
        show("session-removed")
        ui.onNodeWithTag("session-date-removed", useUnmergedTree = true).assertDoesNotExist()
        val inside = hasAnyAncestor(hasTestTag("session-removed"))
        ui.onNodeWithTag("history-date-circle-removed").assertIsDisplayed()
        ui.onNodeWithTag("session-average-removed", useUnmergedTree = true).assertExists()
        ui.onNodeWithTag("session-progress-removed", useUnmergedTree = true).assertExists()
        ui.onNode(inside and hasText("108"), useUnmergedTree = true).assertExists()
        ui.onNode(inside and hasText("/ 120"), useUnmergedTree = true).assertExists()
        ui.onNode(inside and hasText(ui.activity.getString(R.string.session_arrow_count, 12)), useUnmergedTree = true).assertExists()
        val score = ui.onNode(inside and hasText("108"), useUnmergedTree = true)
        val layouts = mutableListOf<TextLayoutResult>()
        score.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
        assertTrue(layouts.single().getLineRight(0) <= layouts.single().size.width + .5f)
        val scoreBounds = score.fetchSemanticsNode().boundsInRoot
        val cardBounds = ui.onNodeWithTag("session-removed").fetchSemanticsNode().boundsInRoot
        assertTrue(scoreBounds.left >= cardBounds.left && scoreBounds.right <= cardBounds.right)
        capture("history-large-font.png")
        show("restore-removed")
        ui.onNodeWithTag("restore-removed").performClick()
        ui.onNodeWithTag("session-removed").assertDoesNotExist()
        show("history-current")
        ui.onNodeWithTag("history-current").performClick()
        show("session-removed")
        ui.onNodeWithTag("restore-removed").assertDoesNotExist()
    }

    private fun capture(name: String) {
        val directory = requireNotNull(ui.activity.getExternalFilesDir("verification"))
        File(directory, name).outputStream().use { output ->
            ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, output)
        }
    }
}
