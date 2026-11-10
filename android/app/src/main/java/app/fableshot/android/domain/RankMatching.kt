package app.fableshot.android.domain

data class RankConditions(val bow: String?, val distance: Double?, val profile: String?, val diameter: Int?)

/** Explicitly supported target/discipline pairs, not guessed from a bow's name. */
fun matchingRankExercises(conditions: RankConditions, category: String): List<RankExercise> {
    val supported = when {
        conditions.distance == 18.0 && conditions.diameter == 400 -> when (conditions.bow) {
            "recurve", "barebow" -> conditions.profile == TargetCatalog.indoor.id
            "compound" -> conditions.profile == TargetCatalog.compound.id
            else -> false
        }
        conditions.distance == 70.0 && conditions.bow == "recurve" ->
            conditions.diameter == 1220 && conditions.profile == TargetCatalog.outdoor.id
        conditions.distance == 50.0 && conditions.bow == "compound" ->
            conditions.diameter == 800 && conditions.profile in listOf(TargetCatalog.outdoor.id, TargetCatalog.reduced.id)
        else -> false
    }
    if (!supported || category !in listOf("male", "female")) return emptyList()
    return SportRankCatalog.exercises.filter {
        it.bow == conditions.bow && it.distance.toDouble() == conditions.distance && it.category == category
    }
}
