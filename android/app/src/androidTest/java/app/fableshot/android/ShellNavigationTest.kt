package app.fableshot.android

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.lifecycle.*
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.ui.FableTheme
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ShellNavigationTest {
    @get:Rule val ui=createAndroidComposeRule<VerificationActivity>()
    private lateinit var db:PracticeDatabase
    private lateinit var repo:PracticeRepository
    private lateinit var preferences:UserPreferences
    private lateinit var prefsScope:CoroutineScope
    private lateinit var prefsFile:File
    private val viewModels=ViewModelStore()
    @Before fun prepare() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        db=Room.inMemoryDatabaseBuilder(context,PracticeDatabase::class.java).build();repo=PracticeRepository(db)
        prefsScope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
        prefsFile=File(context.filesDir,"verification-shell-${UUID.randomUUID()}.preferences_pb")
        preferences=UserPreferences(PreferenceDataStoreFactory.create(scope=prefsScope,produceFile={prefsFile}))
    }
    @After fun cleanup()=runBlocking {
        InstrumentationRegistry.getInstrumentation().runOnMainSync{viewModels.clear()}
        prefsScope.coroutineContext[Job]!!.cancelAndJoin();db.close();prefsFile.delete();Unit
    }
    private fun mount() {
        val owner=object:ViewModelStoreOwner{override val viewModelStore=viewModels}
        val model=ViewModelProvider(owner,PracticeViewModel.Factory(repo))[PracticeViewModel::class.java]
        ui.setContent {
            val read by preferences.state.collectAsState(initial=SettingsRead.Loading)
            FableTheme((read as?SettingsRead.Ready)?.value?:UserSettings()){PracticeShell(model,preferences,read)}
        }
    }
    private fun waitTag(tag:String){ui.waitUntil(10_000){ui.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()}}
    private fun click(tag:String){ui.onNodeWithTag(tag).performClick()}

    @Test fun skipOnboardingNavigationAndSettingsWorkWithoutProfileOrHistory() {
        mount();waitTag("onboarding-screen")
        ui.onNodeWithTag("onboard-skip").performScrollTo().performClick()
        waitTag("home-screen")
        click("nav-history");waitTag("history-screen")
        click("nav-progress");waitTag("progress-screen")
        click("nav-home");click("open-settings");waitTag("settings-screen")
        ui.onNodeWithTag("style-pop").performScrollTo().performClick()
        ui.waitUntil(5_000){runBlocking{(preferences.state.first() as SettingsRead.Ready).value.style==DesignStyle.Pop}}
        ui.onNodeWithTag("appearance-dark").performScrollTo().performClick()
        ui.waitUntil(5_000){runBlocking{(preferences.state.first() as SettingsRead.Ready).value.appearance==Appearance.Dark}}
        click("page-back");waitTag("home-screen")
        assertNull(runBlocking{repo.active.first()})
        assertTrue(runBlocking{repo.history.first()}.isEmpty())
    }

    @Test fun existingActiveSessionSkipsWelcomeAndSurvivesThemeChange()=runBlocking {
        repo.start("Isolated existing user",18.0,600,3)
        val initial=requireNotNull(repo.active.first());val end=initial.currentEnd!!.end.id
        repo.add(end,null,10);repo.add(end,null,9)
        val before=requireNotNull(repo.active.first())
        mount();waitTag("target-input")
        ui.onNodeWithTag("onboarding-screen").assertDoesNotExist()
        click("page-back");waitTag("home-screen");click("open-settings")
        ui.onNodeWithTag("style-minimal").performScrollTo().performClick()
        ui.waitUntil(5_000){runBlocking{(preferences.state.first() as SettingsRead.Ready).value.style==DesignStyle.Minimal}}
        click("page-back");waitTag("home-screen");click("home-primary");waitTag("target-input")
        val after=requireNotNull(repo.active.first())
        assertEquals(before.session,after.session);assertEquals(before.allShots,after.allShots)
        assertEquals(end,after.currentEnd!!.end.id)
        assertEquals(1,(preferences.state.first() as SettingsRead.Ready).value.onboardingVersion)
    }
}

