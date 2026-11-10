package app.fableshot.android.data

import androidx.room.withTransaction
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.domain.TargetScoring
import java.util.UUID

class PracticeRepository(private val db: PracticeDatabase) : PracticeStore {
    private val dao = db.practiceDao()
    override val active = dao.observeActive()
    override val history = dao.observeHistory()

    override suspend fun start(title: String, distance: Double, diameterMm: Int, arrows: Int, operationId: String) = db.withTransaction {
        require(distance.isFinite() && distance > 0 && diameterMm > 0 && arrows in 1..12)
        if (dao.activeSession() == null) {
            val id = UUID.randomUUID().toString()
            dao.insertSession(SessionEntity(id, title, System.currentTimeMillis(), distance, diameterMm, arrows))
            dao.insertEnd(EndEntity(UUID.randomUUID().toString(), id, 1, arrows))
        }
    }

    override suspend fun add(endId: String, point: TargetPoint?, numeric: Int?, operationId: String): ShotEntity? = db.withTransaction {
        val end = dao.end(endId) ?: return@withTransaction null
        if (end.closed || dao.activeSession()?.id != end.sessionId) return@withTransaction null
        val existing = dao.shots(endId)
        if (existing.size >= end.plannedCount) return@withTransaction null
        val score = point?.let(TargetScoring::score) ?: requireNotNull(numeric)
        require(score in 0..10)
        val shot = ShotEntity(UUID.randomUUID().toString(), endId, existing.size, score, point?.x, point?.y, if (point == null) "numeric" else "target", System.currentTimeMillis())
        dao.insertShot(shot)
        shot
    }

    override suspend fun revise(value: ShotEntity, operationId: String): ShotEntity? = db.withTransaction {
        val old = dao.shot(value.id) ?: return@withTransaction null
        val end = dao.end(old.endId) ?: return@withTransaction null
        if (end.closed || dao.activeSession()?.id != end.sessionId) return@withTransaction null
        require(value.points in 0..10 && (value.x == null) == (value.y == null))
        require(value.x == null || (value.x.isFinite() && value.y!!.isFinite()))
        dao.updateShot(value.copy(endId = old.endId, inputIndex = old.inputIndex, createdAt = old.createdAt, revision = old.revision + 1))
        old
    }

    override suspend fun undoInserted(id: String, endId: String, operationId: String) = db.withTransaction {
        val end = dao.end(endId) ?: return@withTransaction
        if (!end.closed && dao.shots(endId).lastOrNull()?.id == id) dao.deleteShot(id)
    }

    override suspend fun next(endId: String, operationId: String) = db.withTransaction {
        val end = dao.end(endId) ?: return@withTransaction
        if (end.closed || dao.latestEnd(end.sessionId)?.id != endId || dao.shots(endId).size != end.plannedCount) return@withTransaction
        dao.closeEnd(endId)
        dao.insertEnd(EndEntity(UUID.randomUUID().toString(), end.sessionId, end.number + 1, end.plannedCount))
    }

    override suspend fun complete(id: String, operationId: String) = db.withTransaction {
        val end = dao.latestEnd(id)
        if (end != null) dao.closeEnd(end.id)
        dao.completeSession(id, System.currentTimeMillis())
    }

    override suspend fun details(id: String, operationId: String) = dao.details(id)
    override suspend fun delete(id: String, operationId: String) = dao.deleteSession(id)
}


