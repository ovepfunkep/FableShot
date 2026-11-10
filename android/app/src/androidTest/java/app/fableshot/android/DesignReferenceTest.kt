package app.fableshot.android

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.ui.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.*

@RunWith(AndroidJUnit4::class)
class DesignReferenceTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private val settings=mutableStateOf(UserSettings(appearance=Appearance.Dark,animations=false,displayName="Лучник"))
    private val saving=mutableStateOf(false)
    private val screen=mutableStateOf("home")
    private val fontScale=mutableFloatStateOf(1f)
    private val epoch=1793257200000L
    private val report=sample("reference-report","Практика на 18 м",epoch-86400000, listOf(10,9,9,9,8,9,10,9,9,8,8,9,9,7,8,10,9,0),true)
    private val active=sample("reference-active","Вечерняя практика",epoch,listOf(10,9,8,9,9,8,10,9),false)
    private val sessions=listOf(active,report,sample("reference-old","Спокойная тренировка",epoch-3*86400000,listOf(8,8,7,9,8,9,7,8,8),true)).map { d->SessionSummary(d.session.id,d.session.title,d.session.startedAt,d.session.state,d.allShots.size,d.allShots.sumOf{it.points},18.0,600,"practice-full-10-v1") }
    private var contrastPairs=listOf<Pair<Color,Color>>()

    private fun sample(id:String,title:String,at:Long,scores:List<Int>,complete:Boolean):SessionDetails {
        val session=SessionEntity(id,title,at,18.0,600,3,state=if(complete)"completed" else "active",completedAt=if(complete)at+3600000 else null)
        val ends=scores.chunked(3).mapIndexed{index,values->val end=EndEntity("$id-e$index",id,index+1,3,complete||values.size==3);EndWithShots(end,values.mapIndexed{i,v->val angle=(index*27+i*81)*PI/180;val radius=if(v==0)null else (10.5-v)/10;ShotEntity("$id-e$index-$i",end.id,i,v,radius?.let{it*cos(angle)},radius?.let{it*sin(angle)},"target",at)})}
        return SessionDetails(session,ends)
    }
    private fun mount() {
        ui.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale.floatValue)) {
                FableTheme(settings.value) {
                    val c=MaterialTheme.colorScheme;val v=LocalFableVisuals.current
                    SideEffect {contrastPairs=listOf(c.onSurface to c.surface,c.onSurfaceVariant to c.surface,c.primary to c.background,v.onAction to v.action)}
                    Surface(Modifier.fillMaxSize(),color=c.background) {
                        TargetOverlayHost(Modifier.fillMaxSize()) {
                            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                                Text("ДИЗАЙН · ПРИМЕР ДАННЫХ",Modifier.fillMaxWidth().background(c.surfaceVariant).padding(horizontal=20.dp,vertical=4.dp),style=MaterialTheme.typography.labelSmall)
                                if(screen.value!="welcome")ShellTopBar(if(screen.value in listOf("home","history","progress"))"root"else screen.value,screen.value,settings.value,{},{},{})
                                Box(Modifier.weight(1f)) {
                                    when(screen.value){
                                        "home"->HomeScreen(sessions,active,settings.value,{},{},{},{})
                                        "history"->HistoryScreen(sessions,{},{})
                                        "progress"->ProgressScreen(sessions)
                                        "report"->ReportScreen(report)
                                        "welcome"->WelcomeScreen({},{},{},{})
                                        "tutorial"->TargetTutorial({},{})
                                        "settings"->SettingsScreen(settings.value,{settings.value=settings.value.copy(style=it)},{settings.value=settings.value.copy(appearance=it)},{settings.value=settings.value.copy(animations=it)},{},{},{},{})
                                        "training"->ActivePractice(active,PracticeCommands({_,_->},{_,_->},{},{},{}),false,saving.value,{},{})
                                    }
                                }
                                if(screen.value in listOf("home","history","progress"))ShellNavigation(screen.value){screen.value=it}
                            }
                        }
                    }
                }
            }
        }
    }
    private fun capture(name:String) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(context.getExternalFilesDir("verification"),"f02").apply{mkdirs()}
        File(directory,name).outputStream().use{ui.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG,100,it)}
    }
    @Test fun savingDoesNotFlashTrainingControls() {
        mount();ui.runOnIdle { screen.value="training" };ui.waitForIdle()
        ui.mainClock.advanceTimeBy(1000);ui.waitForIdle()
        android.os.SystemClock.sleep(600) // Platform ripple runs on Android RenderThread, outside Compose test clock.
        val before=ui.onRoot().captureToImage().asAndroidBitmap()
        ui.runOnIdle { saving.value=true };ui.waitForIdle()
        val during=ui.onRoot().captureToImage().asAndroidBitmap()
        if(!before.sameAs(during)) {
            val context=InstrumentationRegistry.getInstrumentation().targetContext
            val folder=File(context.getExternalFilesDir("verification"),"flash").apply { mkdirs() }
            File(folder,"before.png").outputStream().use { before.compress(Bitmap.CompressFormat.PNG,100,it) }
            File(folder,"during.png").outputStream().use { during.compress(Bitmap.CompressFormat.PNG,100,it) }
        }
        assertTrue("Saving changed pixels of the unchanged training screen",before.sameAs(during))
        ui.runOnIdle { saving.value=false };ui.waitForIdle()
        assertTrue(before.sameAs(ui.onRoot().captureToImage().asAndroidBitmap()))
        ui.onNodeWithTag("shot-0").performClick()
        ui.mainClock.advanceTimeBy(1000);ui.waitForIdle()
        android.os.SystemClock.sleep(600) // Platform ripple runs on Android RenderThread, outside Compose test clock.
        val selected=ui.onRoot().captureToImage().asAndroidBitmap()
        ui.runOnIdle { saving.value=true };ui.waitForIdle()
        assertTrue("Saving flashed the selected arrow",selected.sameAs(ui.onRoot().captureToImage().asAndroidBitmap()))
    }

    @Test fun targetOnlyKeepsArrowStripInSamePlaceWhileEditing() {
        mount();ui.runOnIdle { screen.value="training" };ui.waitForIdle()
        val before=ui.onNodeWithTag("shot-0").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithTag("mode-numbers").assertDoesNotExist()
        ui.onNodeWithTag("mode-target").assertDoesNotExist()
        ui.onNodeWithTag("shot-0").performClick()
        val after=ui.onNodeWithTag("shot-0").fetchSemanticsNode().boundsInRoot
        assertEquals(before,after)
        capture("training-fixed-edit.png")
        ui.onNodeWithTag("undo").performClick()
        assertEquals(before,ui.onNodeWithTag("shot-0").fetchSemanticsNode().boundsInRoot)
        capture("training-fixed-target.png")
    }

    @Test fun sixThemesHaveReadableTextAndFunctionalHome() {
        mount()
        for(style in DesignStyle.entries)for(mode in listOf(Appearance.Light,Appearance.Dark)) {
            ui.runOnIdle{settings.value=settings.value.copy(style=style,appearance=mode)}
            ui.waitForIdle()
            ui.onNodeWithTag("home-primary").assertIsDisplayed().assertIsEnabled()
            ui.runOnIdle {contrastPairs.forEach { (foreground,background)->val a=foreground.luminance();val b=background.luminance();assertTrue("Contrast ${style.wire}/${mode.wire}: $foreground on $background",(max(a,b)+.05f)/(min(a,b)+.05f)>=4.5f)}}
            capture("home-${style.wire}-${mode.wire}.png")
        }
    }
    @Test fun coreScreensRenderAndTutorialUsesOnlyTemporaryShots() {
        mount()
        for(page in listOf("welcome","history","training","report","progress","settings","tutorial")) {
            ui.runOnIdle{screen.value=page};ui.waitForIdle();capture("$page-sport-dark.png")
        }
        ui.onNodeWithTag("target-input").performScrollTo().performTouchInput{click(center)}
        ui.onNodeWithTag("tutorial-shot-0").assertIsEnabled()
        ui.onNodeWithTag("tutorial-next").performScrollTo().performClick()
        ui.onNodeWithTag("tutorial-next").performScrollTo().performClick()
        ui.onNodeWithTag("tutorial-shot-0").performScrollTo().performClick()
        ui.onNodeWithTag("target-input").performScrollTo().performTouchInput{click(center+androidx.compose.ui.geometry.Offset(70f,0f))}
        ui.onNodeWithText("Готово").performScrollTo().performClick()
        ui.runOnIdle{assertEquals(8,active.allShots.size);assertEquals(18,report.allShots.size)}
    }
    @Test fun largeTextKeepsMainActionAvailable() {
        mount();ui.runOnIdle{fontScale.floatValue=1.5f};ui.waitForIdle()
        ui.onNodeWithTag("home-primary").performScrollTo().assertIsDisplayed().assertIsEnabled()
        capture("home-large-text.png")
        ui.runOnIdle{screen.value="welcome"};ui.waitForIdle()
        ui.onNodeWithTag("onboard-start").performScrollTo().assertIsDisplayed().assertIsEnabled()
        capture("welcome-large-text.png")
    }
}

