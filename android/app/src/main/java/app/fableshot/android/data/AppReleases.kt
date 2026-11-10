package app.fableshot.android.data

internal const val LAST_SEEN_RELEASE_CODE_KEY = "last_seen_release_code_v1"

data class AppRelease(
    val versionCode: Int,
    val versionName: String,
    val title: String,
    val highlights: List<String>,
    val important: Boolean = true,
)

/** Release notes ship with the APK and can be read offline. */
object AppReleases {
    val entries = listOf(
        AppRelease(40, "0.19.0", "Свободная тренировка", listOf(
            "Свободные тренировки поддерживают неполные серии, новые раунды и продолжение сохранённых занятий.",
        )),
        AppRelease(41, "0.19.1", "Условия под рукой", listOf(
            "Прошлые серии можно редактировать прямо во время тренировки.",
        ), important = false),
        AppRelease(42, "0.19.2", "Доработки интерфейса", emptyList(), important = false),
        AppRelease(43, "0.19.3", "Доработки интерфейса", emptyList(), important = false),
        AppRelease(44, "0.20.0", "Личные рекорды", listOf(
            "Личные рекорды сопровождаются уведомлениями и сравнением с предыдущим результатом в отчёте.",
        )),
        AppRelease(45, "0.21.0", "Больше поводов улыбнуться", listOf(
            "Новые достижения отмечают личный прогресс, плотные серии и освоенные дистанции.",
        )),
        AppRelease(46, "0.22.0", "Знакомимся со стрелами", listOf(
            "Попадания можно связывать с номером физической стрелы и сравнивать стрелы одного набора.",
            "График среднего балла показывает ход всей тренировки по сериям.",
        )),
        AppRelease(47, "0.23.0", "Доработки номерных стрел", emptyList(), important = false),
        AppRelease(48, "0.23.1", "Доработки интерфейса", emptyList(), important = false),
        AppRelease(49, "0.23.2", "Доработки главной", emptyList(), important = false),
        AppRelease(50, "0.23.3", "Доработки главной", emptyList(), important = false),
        AppRelease(51, "0.24.0", "Подробная аналитика", listOf(
            "Стрелы можно сравнивать на общей мишени по попаданиям и кругам кучности.",
        )),
        AppRelease(52, "0.25.0", "MyTargets становится своим", listOf(
            "Мишени, координаты и заполненное снаряжение MyTargets переносятся для анализа и продолжения тренировок.",
            "Непрерывный график прогресса показывает динамику по всей истории.",
        )),
        AppRelease(53, "0.26.0", "Статистика по твоим правилам", listOf(
            "В настройках можно выбрать показатели и графики, которые хочется видеть.",
        )),
        AppRelease(54, "0.26.1", "Новая глава достижений", listOf(
            "Достижения можно сбросить отдельно от тренировок и статистики.",
        )),
        AppRelease(56, "0.28.0", "Тренировка и техника под рукой", listOf(
            "История тренировок показывает хронологию на вертикальной шкале дат.",
            "Масштаб интерфейса FableShot можно выбирать независимо от увеличения Android.",
            "Компактный редактор памяток сохраняет черновик и поддерживает импорт, экспорт и понятный PDF.",
            "Раунды можно просматривать и начинать досрочно; прогноз разряда относится к выбранному раунду.",
        )),
        AppRelease(57, "0.29.0", "Больше места для стрельбы", listOf(
            "Компактные карточки, статистика и выбор номерных стрел оставляют главное на виду.",
            "Отметка по мишени учитывает диаметр стрелы при касании границы зоны.",
            "Активную тренировку можно показывать поверх экрана блокировки, сохраняя защиту телефона.",
        )),
        AppRelease(58, "0.30.0", "Тренировка под твоим контролем", listOf(
            "Раунды можно ограничить стрелами, сериями или оставить свободными; попадания, серии и раунды доступны для правки и удаления.",
            "Раздельный прогноз разряда серии и раунда виден рядом с результатом; уровень появился и в истории.",
            "Единый компактный редактор и понятные проценты роста помогают разбирать тренировки.",
        )),
        AppRelease(59, "0.30.1", "Плавность и компактные результаты", emptyList(), important = false),
    ).asReversed()
}

/** Returns the full unseen delta. The host opens automatically only if any entry is important. */
fun UserSettings.pendingVersions(editionVersionCode: Int, existingInstallation: Boolean): List<AppRelease> {
    if (!existingInstallation) return emptyList()
    val seen = lastSeenReleaseCode ?: 0
    return AppReleases.entries.filter {
        it.versionCode > seen && it.versionCode <= editionVersionCode
    }
}
