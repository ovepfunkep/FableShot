package app.fableshot.android.domain

/** Outside diameter of the shaft at the impact, in millimetres. */
object ArrowShaft {
    const val DEFAULT_DIAMETER_MM = 6.0
    fun validDiameter(value: Double): Boolean = value.isFinite() && value in 1.0..20.0
}
