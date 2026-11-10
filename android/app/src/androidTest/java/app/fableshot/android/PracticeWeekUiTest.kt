package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.JournalSummaryMeta
import app.fableshot.android.data.SessionSummary
import app.fableshot.android.data.UserSettings
import app.fableshot.android.ui.FableTheme
import app.fableshot.android.ui.HomeScreen
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

class PracticeWeekUiTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val today=LocalDate.now()

    private fun session(id:String,day:LocalDate=today,scored:Boolean=true,progress:Double?=null,hour:Int=12)=SessionSummary(
        id,"Тренировка $id",day.atTime(hour,0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
        "completed",12,if(scored)108 else 0,18.0,400,"practice-full-10-v1",
        JournalSummaryMeta(1,if(scored)12 else 0,true,!scored,localDate=day.toString(),
            progressPercentagePoints=progress,progressReady=true),
    )

    private fun mount(sessions:List<SessionSummary>,fontScale:State<Float> = mutableFloatStateOf(1f),onSession:(SessionSummary)->Unit={}) {
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale.value)) {
                FableTheme(UserSettings(animations=false)) {
                    Surface(Modifier.fillMaxSize()) {
                        HomeScreen(sessions,null,UserSettings(),{},{},{},onSession)
                    }
                }
            }
        }
    }

    private fun show(tag:String) {
        ui.onNodeWithTag("home-screen").performScrollToNode(hasTestTag(tag))
        ui.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
    }

    private fun capture(name:String) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(context.getExternalFilesDir("verification"),"practice-week").apply { mkdirs() }
        File(directory,name).outputStream().use { output->
            assertTrue(ui.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG,100,output))
        }
    }

    @Test fun allTimeTotalsIncludeOldAndUndatedSessionsAndPracticeMarksDemos() {
        val demo = session("demo", today.minusDays(1)).copy(title = "Демо · недавняя тренировка")
        val older = session("older-demo", today.minusMonths(6)).copy(title = "Демо · прошлая тренировка")
        val undated = session("undated").let {
            it.copy(journalMeta = it.journalMeta!!.copy(localDate = null, dateKnown = false))
        }
        var opened: String? = null
        mount(listOf(demo, older, undated, session("own", today.minusDays(1), hour = 10)), onSession = { opened = it.id })

        val home = ui.onNodeWithTag("home-screen")
        val totals = hasAnyAncestor(hasTestTag("home-all-time-totals"))
        home.performScrollToNode(hasTestTag("home-all-time-totals"))
        ui.onNodeWithText("За всё время").assertDoesNotExist()
        ui.onNode(totals and hasText("4")).assertExists()
        ui.onNode(totals and hasText("48")).assertExists()
        home.performScrollToNode(hasText("Твоя недавняя практика"))
        ui.onNodeWithText("Твоя недавняя практика").assertIsDisplayed()

        show("home-practice-demo")
        val demoTag = "home-practice-demo-${demo.id}"
        if (BuildConfig.APPLICATION_ID == "app.fableshot.android.verification") {
            show(demoTag)
            ui.onNode(hasAnyAncestor(hasTestTag(demoTag)) and hasText("Демо"), useUnmergedTree = true).assertIsDisplayed()
        } else {
            ui.onNodeWithTag(demoTag).assertDoesNotExist()
        }
        ui.onNodeWithTag("home-practice-demo-own", useUnmergedTree = true).assertDoesNotExist()
        ui.onNodeWithTag("home-practice-undated").assertDoesNotExist()
        show("home-practice-demo")
        ui.onNodeWithTag("home-practice-demo").performClick()
        assertEquals(demo.id, opened)
    }

    @Test fun practiceShowsTheFiveLatestEligibleSessionsInDateOrder() {
        val previousMonth=today.withDayOfMonth(1).minusDays(1)
        val dates=listOf(today)+(0..5).map { previousMonth.minusDays(it*2L) }
        val latest=session("latest",progress=2.5)
        val selected=listOf(latest)+dates.drop(1).mapIndexed { index,day->session("older-$index",day) }
        val unknown=session("unknown-date").let { it.copy(journalMeta=it.journalMeta!!.copy(localDate=null,dateKnown=false)) }
        var opened:String?=null
        mount(selected.reversed()+listOf(unknown,
            session("empty").copy(shotCount=0),session("active").copy(state="active"),session("future",today.plusDays(1))),
            onSession={opened=it.id})
        show("home-practice-point-${latest.id}")
        assertNull(ui.onNodeWithTag("home-practice-horizontal").fetchSemanticsNode()
            .config.getOrNull(SemanticsProperties.HorizontalScrollAxisRange))
        assertSingleAxis(selected.take(5).asReversed().map { it.id })
        listOf("unknown-date", "empty", "active", "future", "older-4", "older-5").forEach {
            ui.onNodeWithTag("home-practice-$it").assertDoesNotExist()
        }
        selected.take(5).forEach { show("home-practice-${it.id}") }
        dates.take(5).map(YearMonth::from).distinct().forEach {
            ui.onNodeWithTag("home-practice-month-$it", useUnmergedTree = true).assertExists()
        }
        ui.onNodeWithText(today.year.toString(),substring=true,useUnmergedTree=true).assertDoesNotExist()
        ui.onNodeWithText("+2.50 п.п.",substring=true,useUnmergedTree=true).assertDoesNotExist()
        assertTrue(ui.onAllNodesWithTag("home-practice-session").fetchSemanticsNodes().any { node->
            node.config.getOrNull(SemanticsProperties.ContentDescription)?.any { latest.title in it }==true
        })
        show("home-practice-${latest.id}")
        val latestCard = hasAnyAncestor(hasTestTag("home-practice-${latest.id}"))
        ui.onNode(latestCard and hasText("108/120"), useUnmergedTree = true).assertExists()
        ui.onNode(latestCard and hasText("9,0"), useUnmergedTree = true).assertExists()
        capture("adaptive-practice-normal.png")
        ui.onNodeWithTag("home-practice-${latest.id}").performClick()
        assertEquals(latest.id,opened)
    }

    @Test fun largeFontPreservesFiveSessionsIncludingMultipleOnTheSameDay() {
        val newest=today.withDayOfMonth(1).minusDays(1)
        val dates=(0..6).map { newest.minusDays(it*2L) }
        val sessions=dates.mapIndexed { index,day->session("single-$index",day) }+
            listOf(session("same-day-progress",newest,progress=1.0,hour=16),
                session("same-day-counter",newest,scored=false,hour=20))
        var opened:String?=null
        val fontScale=mutableFloatStateOf(1f)
        mount(sessions,fontScale=fontScale,onSession={opened=it.id})
        val latestIds = listOf("single-2", "single-1", "single-0", "same-day-progress", "same-day-counter")
        show("home-practice-point-same-day-counter")
        assertSingleAxis(latestIds)
        ui.runOnIdle { fontScale.floatValue=1.6f }
        ui.waitForIdle()
        show("home-practice-point-same-day-counter")
        assertSingleAxis(latestIds)
        ui.onNodeWithTag("home-practice-month-${YearMonth.from(newest)}", useUnmergedTree = true).assertDoesNotExist()
        sessions.forEach { ui.onNodeWithText(it.title,useUnmergedTree=true).assertDoesNotExist() }
        listOf("Пока нет сравнения","нет оценённых стрел","Новые тренировки сверху","Последние 5 дней с тренировками","Вся история").forEach {
            ui.onNodeWithText(it,substring=true,useUnmergedTree=true).assertDoesNotExist()
        }
        val countOnlyCard = hasAnyAncestor(hasTestTag("home-practice-same-day-counter"))
        ui.onNode(countOnlyCard and hasText("12 стрел"), useUnmergedTree = true).assertExists()
        ui.onNode(countOnlyCard and hasText("—"), useUnmergedTree = true).assertExists()
        ui.onNodeWithText("+1.00 п.п.",substring=true,useUnmergedTree=true).assertDoesNotExist()
        listOf("single-3", "single-4", "single-5", "single-6").forEach {
            ui.onNodeWithTag("home-practice-$it").assertDoesNotExist()
        }
        latestIds.forEach { show("home-practice-$it") }
        capture("adaptive-practice-large-font.png")
        show("home-practice-same-day-counter")
        ui.onNodeWithTag("home-practice-same-day-counter").performClick()
        assertEquals("same-day-counter",opened)
    }

    private fun assertSingleAxis(ids: List<String>) {
        ui.onAllNodesWithTag("home-practice-right-arrow").assertCountEquals(1)
        ui.onAllNodesWithTag("home-practice-session").assertCountEquals(ids.size)
        val points = ids.map {
            ui.onNodeWithTag("home-practice-point-$it").fetchSemanticsNode().positionInRoot
        }
        assertTrue(points.zipWithNext().all { (older, newer) -> older.x < newer.x && older.y == newer.y })

        val cards = ids.map {
            ui.onNodeWithTag("home-practice-$it").fetchSemanticsNode().positionInRoot
        }
        assertTrue(cards.zipWithNext().withIndex().all { (index, pair) ->
            val (left, right) = pair
            left.x < right.x && if (index % 2 == 0) left.y < right.y else left.y > right.y
        })
        assertEquals(2, cards.map { it.y }.distinct().size)
    }
}
