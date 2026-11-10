package app.fableshot.android

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicit one-off upgrade/read only. No fabricated rows or writes to the user's diary. */
class PrimaryJournalProbe {
    @Test fun openThroughProductionBuilderAfterVerifiedBackup()=runBlocking(Dispatchers.IO) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifiedBackupAvailable") in setOf("schema1-verified","schema2-verified"))
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as FableShotApplication
        val rows=withTimeout(15_000){app.repository.journal.history.first()}
        assertEquals(2,rows.size)
        assertEquals(15,rows.sumOf{it.allShots.size})
        assertEquals(141,rows.sumOf{it.allShots.sumOf{shot->shot.points}})
        assertTrue(rows.all{it.blocks.size==1})
    }
}
