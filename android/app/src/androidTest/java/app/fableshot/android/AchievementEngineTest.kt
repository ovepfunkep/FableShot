package app.fableshot.android

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import app.fableshot.android.data.*
import app.fableshot.android.data.journal.*
import app.fableshot.android.domain.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.*
import org.junit.Assert.*
import java.time.LocalDate
import java.time.ZoneOffset

class AchievementEngineTest {
    private lateinit var db: JournalDatabase
    private lateinit var repo: JournalRepository
    private val snapshots = mutableMapOf<String, String>()
    private var clock = LocalDate.of(2026, 11, 3).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()

    @Before fun create() {
        db = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, JournalDatabase::class.java).build()
        repo = JournalRepository(db, now = { clock })
    }
    @After fun close() { db.close() }

    private fun plan(category: String = "barebow", ends: Int? = null): BlockPlan {
        val snapshot = snapshots.getOrPut(category) {
            val bow = EquipmentItem(id = "bow-$category", kind = "bow", name = "Test bow", category = category)
            equipmentSnapshot(bow, listOf(bow))!!
        }
        return BlockPlan(18.0, 400, 3, equipmentSnapshotJson = snapshot, plannedEnds = ends,
            targetProfileId = "wa-indoor-outer-v1", rankCategory = "male")
    }
    private suspend fun start(category: String = "barebow", ends: Int? = null): String =
        (repo.start("Новая тренировка", plan(category, ends)) as JournalWrite.Saved).sessionId
    private suspend fun triple(id: String) {
        val end = repo.details(id)!!.currentEnd!!.end.id
        repeat(3) { assertTrue(repo.point(end, TargetPoint(.01, .01)) is JournalWrite.Saved) }
    }
    private suspend fun complete(id: String) {
        assertTrue(repo.complete(id, repo.details(id)!!.session.revision) is JournalWrite.Saved)
    }
    private suspend fun legacy(id: String = "old", date: String? = "2026-10-03", points: Int = 9, source: String = "mytargets", future: Boolean = false) {
        val old = (date?.let { LocalDate.parse(it) } ?: LocalDate.of(2026, 10, 3))
            .atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        val prototype = reportFixture().blocks.first().block
        db.journalDao().insert(JournalSession(id, "Предыдущая история", if(future)clock+999_999_999 else old,
            old, old, date, "UTC", state = "completed", sourceKind = source))
        db.journalDao().insert(prototype.copy(id = "$id-block", sessionId = id, ordinal = 0, equipmentSnapshotJson = plan().equipmentSnapshotJson))
        db.journalDao().insert(JournalEnd("$id-end", "$id-block", 0, 3, state = "closed", createdAtMs = old, closedAtMs = old))
        repeat(3) { index -> db.journalDao().insert(JournalShot("$id-shot-$index", "$id-end", index, points, points.toString(),
            null, null, null, null, null, "imported", "none", "unknown", null, old)) }
    }

    @Test fun previousNativeAndImportedHistoryIncludingFutureDatesHasZeroAchievementProgress() = runBlocking(Dispatchers.IO) {
        legacy(); legacy("old-native", source = "native", future = true)
        assertTrue(db.achievementDao().grants().isEmpty())
        val before = repo.achievements.board.first()
        assertTrue(before.statuses.all { it.value == 0L && it.earned == null })
        val fresh = start(); triple(fresh); complete(fresh)
        val after = repo.achievements.board.first()
        assertEquals(3L, after.statuses.first { it.definition.id == "START06" }.value)
        assertEquals(fresh, db.achievementDao().grant("START01:global")?.sessionId)
        assertEquals(3, repo.details("old")!!.allShots.size)
    }

    @Test fun qualityAwardsAreImmediateCategorySpecificGroupedAndClaimedOnlyOnce() = runBlocking(Dispatchers.IO) {
        val first = start(); triple(first)
        val early = db.achievementDao().grants()
        assertTrue(early.any { it.ruleId == "HIT01" && it.scope == "barebow" })
        assertFalse(early.any { it.ruleId == "START01" })
        val group = groupAchievements(early.map { it.presentation() }).first { it.main.family == "group" }
        assertEquals(3, group.others.size)
        assertEquals("GROUP08", group.main.ruleId)
        assertEquals(early.size, repo.achievements.claimNotifications(early.map { it.key }).size)
        assertTrue(repo.achievements.claimNotifications(early.map { it.key }).isEmpty())
        complete(first)
        val second = start("compound"); triple(second)
        val compound = requireNotNull(db.achievementDao().grant("HIT01:compound"))
        val barebow = requireNotNull(db.achievementDao().grant("HIT01:barebow"))
        assertTrue(compound.rarity < barebow.rarity)
        assertTrue(AchievementEngine(db, WriteGate()).board.first().awards.any { it.key == barebow.key })
    }

    @Test fun failedAwardWriteRollsBackShotAndReceiptThenRetryIsIdempotent() = runBlocking(Dispatchers.IO) {
        val id = start(); val end = repo.details(id)!!.currentEnd!!.end.id
        repeat(2) { repo.point(end, TargetPoint(.01, .01)) }
        db.openHelper.writableDatabase.execSQL("CREATE TRIGGER fail_award BEFORE INSERT ON achievement_grants BEGIN SELECT RAISE(ABORT,'fixture'); END")
        assertTrue(runCatching { repo.point(end, TargetPoint(.01, .01), "same-operation") }.isFailure)
        assertEquals(2, repo.details(id)!!.allShots.size)
        assertNull(db.journalDao().receipt("same-operation"))
        assertTrue(db.achievementDao().grants().isEmpty())
        db.openHelper.writableDatabase.execSQL("DROP TRIGGER fail_award")
        assertTrue(repo.point(end, TargetPoint(.01, .01), "same-operation") is JournalWrite.Saved)
        val count = db.achievementDao().grants().size
        assertTrue((repo.point(end, TargetPoint(.01, .01), "same-operation") as JournalWrite.Saved).replayed)
        assertEquals(count, db.achievementDao().grants().size)
    }

    @Test fun laterRulesCannotCountAlreadyStartedSessionsAndCorrectionsDoNotReplayGrants() = runBlocking(Dispatchers.IO) {
        val old = start()
        db.openHelper.writableDatabase.execSQL("UPDATE achievement_enrollments SET ruleIdsJson='[\"START01\"]' WHERE sessionId=?", arrayOf(old))
        triple(old); complete(old)
        assertNull(db.achievementDao().grant("HIT01:barebow"))
        val fresh = start(); triple(fresh)
        val keys = db.achievementDao().grants().map { it.key }
        repo.achievements.claimNotifications(keys)
        val shot = repo.details(fresh)!!.allShots.first()
        repo.revise(shot.copy(points = 8, zoneCode = "8", scoreSource = "manual_edit"))
        assertFalse(db.achievementDao().grant("HIT01:barebow")!!.valid)
        val current = db.journalDao().shot(shot.id)!!
        repo.revise(current.copy(points = 10, zoneCode = "10", scoreSource = "manual_edit"))
        assertTrue(db.achievementDao().grant("HIT01:barebow")!!.valid)
        assertNotNull(db.achievementDao().grant("HIT01:barebow")!!.notifiedAtMs)
        assertTrue(repo.achievements.claimNotifications(keys).isEmpty())
    }

    @Test fun completedByNextProducesNewPracticeAndMonthRecordAgainstImportedBaseline() = runBlocking(Dispatchers.IO) {
        legacy()
        val id = start(ends = 1); triple(id)
        val end = repo.details(id)!!.currentEnd!!.end
        repo.next(end.id, end.revision)
        assertEquals("completed", repo.details(id)!!.session.state)
        assertNotNull(db.achievementDao().grant("START01:global"))
        assertNotNull(db.achievementDao().grant("PROGRESS04:barebow"))
        assertNotNull(db.achievementDao().grant("PROGRESS10:barebow"))
    }

    @Test fun lessThanCalendarMonthDoesNotEarnFinallyAndServiceImportDoesNotEarnSports() = runBlocking(Dispatchers.IO) {
        legacy(date = "2026-10-04")
        repo.achievements.service("APP01", "new-import", clock)
        repo.achievements.service("APP01", "new-import", clock)
        assertEquals(listOf("APP01"), db.achievementDao().grants().map { it.ruleId })
        val id = start(); triple(id); complete(id)
        assertNotNull(db.achievementDao().grant("PROGRESS04:barebow"))
        assertNull(db.achievementDao().grant("PROGRESS10:barebow"))
    }

    @Test fun aTieIsNotANewRecordAndUnknownDateDoesNotInventRecordAge() = runBlocking(Dispatchers.IO) {
        legacy(points = 10)
        val id = start(); triple(id); complete(id)
        assertNull(db.achievementDao().grant("PROGRESS04:barebow"))
        assertNull(db.achievementDao().grant("PROGRESS10:barebow"))
    }

    @Test fun unknownDateCanBeRecordBaselineButCannotProveAMonth() = runBlocking(Dispatchers.IO) {
        legacy(date = null)
        val id = start(); triple(id); complete(id)
        assertNotNull(db.achievementDao().grant("PROGRESS04:barebow"))
        assertNull(db.achievementDao().grant("PROGRESS10:barebow"))
    }

    @Test fun calendarMonthEndWorksWithoutDemandingThirtyDailyPractices() = runBlocking(Dispatchers.IO) {
        clock = LocalDate.of(2026, 2, 28).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        legacy(date = "2026-01-31")
        val id = start(); triple(id); complete(id)
        assertNotNull(db.achievementDao().grant("PROGRESS10:barebow"))
    }

    @Test fun fiveConsecutiveTightSeriesAndGoldenFinishAreIndependent() = runBlocking(Dispatchers.IO) {
        val id = start()
        repeat(5) {
            triple(id)
            val end = repo.details(id)!!.currentEnd!!.end
            assertTrue(repo.next(end.id, end.revision) is JournalWrite.Saved)
        }
        assertNotNull(db.achievementDao().grant("GROUP05:barebow"))
        assertNull(db.achievementDao().grant("STORY01:barebow"))
        triple(id)
        val finalEnd = repo.details(id)!!.currentEnd!!.end.id
        complete(id)
        assertEquals(finalEnd, db.achievementDao().grant("STORY01:barebow")?.endId)
        assertNull(db.achievementDao().grant("STORY01:compound"))
    }

    @Test fun changedConditionsBreakTheTightRunAndPartialFinalSeriesDoesNotEarnGoldenFinish() = runBlocking(Dispatchers.IO) {
        val id = start()
        suspend fun series() {
            triple(id)
            val end = repo.details(id)!!.currentEnd!!.end
            assertTrue(repo.next(end.id, end.revision) is JournalWrite.Saved)
        }
        suspend fun changeDistance(distance: Double) {
            val revision = repo.details(id)!!.session.revision
            assertTrue(repo.startBlock(id, plan().copy(distanceMeters = distance), revision, allowPartial = true) is JournalWrite.Saved)
        }
        repeat(2) { series() }
        changeDistance(25.0)
        series()
        changeDistance(18.0)
        repeat(3) { series() }
        val last = repo.details(id)!!.currentEnd!!.end
        assertTrue(repo.point(last.id, TargetPoint(.01, .01)) is JournalWrite.Saved)
        complete(id)
        assertNull(db.achievementDao().grant("GROUP05:barebow"))
        assertNull(db.achievementDao().grant("STORY01:barebow"))
    }

    @Test fun closeDistanceAndMissingBowDoNotReceiveCompetitiveEighteenMetreBadges() = runBlocking(Dispatchers.IO) {
        val close = (repo.start("Близкая мишень", plan().copy(distanceMeters = 5.0)) as JournalWrite.Saved).sessionId
        triple(close); complete(close)
        assertNotNull(db.achievementDao().grant("START02:barebow"))
        assertNull(db.achievementDao().grant("HIT01:barebow"))
        val unknown = (repo.start("Неизвестный лук", plan().copy(equipmentSnapshotJson = null)) as JournalWrite.Saved).sessionId
        triple(unknown); complete(unknown)
        assertFalse(db.achievementDao().grants().any { it.sessionId == unknown && it.scope != "global" })
    }

    @Test fun abandonedEmptyConditionsDoNotPreventWholeTrainingQuality() = runBlocking(Dispatchers.IO) {
        val id = (repo.start("Смена до первого выстрела", plan().copy(distanceMeters = 5.0)) as JournalWrite.Saved).sessionId
        assertTrue(repo.startBlock(id, plan(), repo.details(id)!!.session.revision, allowPartial = true) is JournalWrite.Saved)
        repeat(10) { index ->
            triple(id)
            if(index < 9) { val end = repo.details(id)!!.currentEnd!!.end; repo.next(end.id, end.revision) }
        }
        complete(id)
        assertNotNull(db.achievementDao().grant("SCORE03:barebow"))
    }

    @Test fun correctingTheCurrentArrowCanEarnImmediatelyButCompletedHistoryCannotStealANewTrigger() = runBlocking(Dispatchers.IO) {
        val old = start()
        val end = repo.details(old)!!.currentEnd!!.end.id
        repeat(3) { repo.numeric(end, 9) }; complete(old)
        for(shot in repo.details(old)!!.allShots)repo.revise(shot.copy(points=10,zoneCode="10",scoreSource="manual_edit"))
        assertNull(db.achievementDao().grant("HIT01:barebow"))
        val fresh = start()
        val freshEnd=repo.details(fresh)!!.currentEnd!!.end.id
        repeat(3) { repo.numeric(freshEnd, if(it==0)9 else 10) }
        assertNull(db.achievementDao().grant("HIT01:barebow"))
        val current=repo.details(fresh)!!.allShots.first()
        repo.revise(current.copy(points=10,zoneCode="10",scoreSource="manual_edit"))
        assertEquals(fresh,db.achievementDao().grant("HIT01:barebow")?.sessionId)
        assertEquals(freshEnd,db.achievementDao().grant("HIT01:barebow")?.endId)
    }

    @Test fun aBetterHistoricalResultImportedDuringAnActiveSessionPreventsAFakeNewRecord() = runBlocking(Dispatchers.IO) {
        legacy()
        val id=start();triple(id)
        legacy(id="late-import",date="2026-10-30",points=10)
        db.openHelper.writableDatabase.execSQL("UPDATE sessions SET createdAtMs=? WHERE id='late-import'",arrayOf(clock+1000))
        clock+=2000
        complete(id)
        assertNull(db.achievementDao().grant("PROGRESS04:barebow"))
        assertNull(db.achievementDao().grant("PROGRESS10:barebow"))
    }

    @Test fun traditionalPerfectExerciseIsRewardedWithoutInventingOfficialNorms() = runBlocking(Dispatchers.IO) {
        val id=start("traditional",20)
        repeat(20) {
            triple(id)
            val end=repo.details(id)!!.currentEnd!!.end
            repo.next(end.id,end.revision)
        }
        assertNotNull(db.achievementDao().grant("HIT10:traditional"))
        assertFalse(db.achievementDao().grants().any {it.ruleId.startsWith("RANK")})
        assertFalse(repo.achievements.board.first().statuses.any {
            it.scope=="traditional"&&(it.definition.id.startsWith("RANK")||it.definition.id=="PROGRESS06")
        })
    }

    @Test fun comparisonChosenBeforeCompletionIsCapturedEvenWhenItWasUnsetAtStart() = runBlocking(Dispatchers.IO) {
        var chosen:String?=null
        repo=JournalRepository(db,WriteGate(),{clock},{chosen})
        val id=(repo.start("Новая категория",plan(ends=20).copy(rankCategory=null)) as JournalWrite.Saved).sessionId
        repeat(20) {index->
            triple(id)
            if(index<19){val end=repo.details(id)!!.currentEnd!!.end;repo.next(end.id,end.revision)}
        }
        chosen="female"
        complete(id)
        assertEquals("female",db.achievementDao().enrollment(id)?.rankCategory)
        val award=requireNotNull(db.achievementDao().grant("RANK09:barebow"))
        assertTrue(award.description.contains("КЛб(Ж)"))
    }
}
