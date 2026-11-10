package app.fableshot.android.data

internal const val DISABLED_STATISTICS_KEY = "disabled_statistics_v1"

enum class StatisticSection(val title: String) {
    Main("Основные показатели"),
    Evaluation("Оценка и прогресс"),
    Target("Попадания"),
    Charts("Графики"),
}

/** Visibility choices use stable identifiers so archives and future app versions retain them. */
enum class StatisticFeature(val wire: String, val title: String, val section: StatisticSection) {
    Result("result", "Классические очки", StatisticSection.Main),
    Average("average", "Средний балл", StatisticSection.Main),
    Volume("volume", "Стрелы и тренировки", StatisticSection.Main),
    TrainingTime("training_time", "Время стрельбы", StatisticSection.Main),
    Series("series", "Результаты раундов и серий", StatisticSection.Main),
    GeneralScore("general_score", "Общие очки", StatisticSection.Evaluation),
    Stability("stability", "Стабильность", StatisticSection.Evaluation),
    ProgressScore("progress_score", "Прогрессивные очки", StatisticSection.Evaluation),
    Norms("norms", "Нормативы и разряд", StatisticSection.Evaluation),
    Records("records", "Личные рекорды", StatisticSection.Evaluation),
    Grouping("grouping", "Кучность", StatisticSection.Target),
    Offset("offset", "Смещение от центра", StatisticSection.Target),
    HitMap("hit_map", "Карта попаданий", StatisticSection.Target),
    NumberedArrows("numbered_arrows", "Статистика номерных стрел", StatisticSection.Target),
    MeanTrend("mean_trend", "Средний балл по сериям", StatisticSection.Charts),
    GeometryTrend("geometry_trend", "Кучность и точность по тренировкам", StatisticSection.Charts),
    Distribution("distribution", "Распределение попаданий", StatisticSection.Charts),
    ZoneTrend("zone_trend", "Доля десяток, X и промахов", StatisticSection.Charts),
    ProgressTrend("progress_trend", "Динамика прогресса", StatisticSection.Charts),
}
