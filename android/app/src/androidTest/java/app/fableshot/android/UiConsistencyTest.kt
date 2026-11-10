package app.fableshot.android

import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.summary
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class UiConsistencyTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()

    @Test fun shareButtonCreatesThemedCardWithoutSendingItToAnyoneAutomatically() {
        val prepared=mutableStateOf<Pair<List<File>,List<Uri>>?>(null)
        val resolver=ui.activity.contentResolver
        ui.setContent {FableTheme(UserSettings(appearance=Appearance.Light,animations=false)) {
            Surface {TrainingShareButton(reportFixture(),UserSettings(rankCategory="male"),onPrepared={files,saved -> prepared.value=files to saved})}
        }}
        ui.onNodeWithTag("training-share").assertIsEnabled().performClick()
        ui.waitUntil(10000) {prepared.value!=null}
        try {
            val (files,saved)=requireNotNull(prepared.value)
            assertEquals(1,files.size)
            assertTrue(files.single().length()>1000)
            assertEquals(1,saved.size)
            assertArrayEquals(files.single().readBytes(),resolver.openInputStream(saved.single())!!.use {it.readBytes()})
        } finally {
            prepared.value?.second.orEmpty().forEach {resolver.delete(it,null,null)}
            prepared.value?.first.orEmpty().forEach {it.delete()}
        }
    }

    @Test fun onlyChangedTimerDigitMovesWhilePrefixAndColonStayStill() {
        val value=mutableStateOf("01:59")
        ui.mainClock.autoAdvance=false
        ui.setContent {FableTheme(UserSettings(animations=true)) {
            val visuals=LocalFableVisuals.current
            CompositionLocalProvider(LocalFableVisuals provides visuals.copy(motion=true)) {
                Surface {SlidingValue(value.value,Modifier.width(300.dp).testTag("digits"),style=MaterialTheme.typography.displayLarge,alignment=Alignment.Center,byCharacter=true)}
            }
        }}
        val before=ui.onNodeWithTag("digits").captureToImage().asAndroidBitmap()
        ui.runOnIdle {value.value="01:58"}
        ui.mainClock.advanceTimeByFrame();ui.mainClock.advanceTimeBy(80)
        val during=ui.onNodeWithTag("digits").captureToImage().asAndroidBitmap()
        for(x in 0 until before.width*55/100)for(y in 0 until before.height)assertEquals("Stable prefix pixel $x,$y",before.getPixel(x,y),during.getPixel(x,y))
        ui.mainClock.advanceTimeBy(250)
        ui.onNodeWithTag("digits").assertTextEquals("01:58")
    }

    @Test fun achievementsHaveOneNeutralEntryInsideTheBlockAndNoDuplicateArrow() {
        val summary=reportFixture().summary()
        ui.setContent {FableTheme(UserSettings(animations=false)) {
            Column {ProfileRankSummary(listOf(summary),{});ProfileAchievementsCard(listOf(summary),{})}
        }}
        ui.onAllNodesWithTag("profile-achievements-open").assertCountEquals(1)
        ui.onNodeWithContentDescription("Коллекция достижений").assertDoesNotExist()
        ui.onNodeWithTag("profile-ranks").assertDoesNotExist()
        val card=ui.onNodeWithTag("profile-achievements").fetchSemanticsNode().boundsInRoot
        val button=ui.onNodeWithTag("profile-achievements-open").fetchSemanticsNode().boundsInRoot
        assertTrue(card.contains(button.center))
    }

    @Test fun equipmentArchiveIsDirectAndFooterActionsRemainInOneRowAtLargeFont() {
        val items=mutableStateOf(listOf(EquipmentItem(id="bow",kind="bow",name="Орешник",category="barebow",favorite=true)))
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,2f)) {
                FableTheme(UserSettings(animations=false)) {EquipmentScreen(items.value,false,false) {value,after->items.value=listOf(value);after()}}
            }
        }
        ui.onNodeWithContentDescription("Действия снаряжения").assertDoesNotExist()
        ui.onNodeWithText("Версия",substring=true).assertDoesNotExist()
        val favorite=ui.onNodeWithTag("equipment-favorite-bow").fetchSemanticsNode().boundsInRoot
        val archive=ui.onNodeWithTag("equipment-archive-bow").fetchSemanticsNode().boundsInRoot
        assertTrue(kotlin.math.abs(favorite.center.y-archive.center.y)<4)
        ui.onNodeWithTag("equipment-archive-bow").performClick()
        ui.onNodeWithTag("equipment-card-bow").assertDoesNotExist()
        ui.onNodeWithTag("equipment-show-archive").performClick()
        ui.onNodeWithTag("equipment-card-bow").assertExists()
        ui.onNodeWithTag("equipment-archive-bow").performClick()
        ui.onNodeWithTag("equipment-card-bow").assertDoesNotExist()
    }
}
