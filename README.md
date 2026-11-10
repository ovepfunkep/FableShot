# FableShot

Android-дневник стрельбы из лука на Kotlin и Jetpack Compose.

## Сборка после клонирования

Нужны JDK 17 и Android SDK 36. В Android Studio открой каталог `android`; для командной строки укажи SDK через `ANDROID_HOME` или локальный `android/local.properties`.

```powershell
cd android
./gradlew.bat assembleDebug assembleVerification testDebugUnitTest
```

В Linux/macOS используй `./gradlew` с теми же задачами. Проверочные данные в `docs/fixtures` синтетические; телефонные дневники, личные экспорты, ключи и локальный инструментарий в репозиторий не входят. Конфигурация `.tools/android-toolchain.json` нужна только для существующего Windows-скрипта сборки через ASCII-каталог, обычному Gradle она не требуется. Инструкции для агента и документы проекта — ниже.

Для продолжения разработки: [AGENTS.md](AGENTS.md), затем один раз [рабочая очередь](docs/work-queue.md). Текущий статус, незавершённая работа и следующий шаг находятся только в очереди. Требования к функциям — в спецификациях; большие планы и история проверок читаются по необходимости.

## Основные документы

- [План выполненных и будущих работ для заказчика](PRODUCT_ROADMAP.md).
- [Технический план разработки и критерии готовности](DEVELOPMENT_PLAN.md).
- [Решения и открытые вопросы](docs/decisions.md).
- [Концепция и каталог возможностей](docs/product.md).
- [Экраны и состояния](docs/screens.md).
- [Первый запуск и обучение приложению](docs/onboarding.md).
- [Тренировка и ввод попаданий](docs/training.md), [детальная компоновка активного экрана](docs/design/active-training.md).
- [Рабочая очередь и точка продолжения](docs/work-queue.md).
- [Ночная автономная работа](docs/autonomous-work.md), [её результаты](docs/overnight-progress.md), [вопросы к Ивану](docs/questions-for-ivan.md).
- [Аналитика и отчёты](docs/analytics.md).
- [Показатели, отдельная статистика тренировки и будущие отчёты](docs/metrics-and-reports.md).
- [Классические, Общие и Прогрессивные очки](docs/scoring-and-progress.md).
- [Групповая комната, срезы и локальная история](docs/group-session.md).
- [Первый прототип через точку доступа](docs/local-room.md).
- [Личная шпаргалка техники](docs/technique.md).
- [Рекорды и достижения](docs/motivation.md).
- [Фото и ручная разметка](docs/photos.md).
- [Данные, импорт MyTargets и архивы](docs/data-and-import.md).
- [Конкретный контракт данных](docs/architecture/data-contract.md), [план миграций](docs/architecture/migrations.md), [проверки хранения F01](docs/verification/f01-persistence.md).
- [Требования разработки и этапы](docs/development.md).
- [Выбранная техническая основа](docs/resolved/platform/README.md).
- [Исходники Android и сборка](android/README.md).
- [Проверочный CSV MyTargets](docs/fixtures/README.md).

## Дизайн и идеи

- [Три направления дизайна](docs/design/directions.md), [правила тем](docs/design/theme-system.md).
- [Реализованная дизайн-система F02](docs/design/design-system.md), [нативные эталонные снимки и проверки](docs/verification/f02-design.md).
- [Сравнительный макет](docs/design/design-directions-v1.png), [запрос для макета](docs/design/comparison-prompt.txt).
- [Активный брейншторм](docs/brainstorm/README.md): будущие отчёты и резервные транспорты; оценивание и структура лидерборда уже закрыты.
- [Идеи на потом](docs/ideas-later/README.md): в том числе эдиты рекордов.

У каждой тренировки отдельное окно статистики. Первичные данные и версионированные метрики обеспечивают подробные сравнения, отчёты, достижения и анимационные события. Окончательный набор отчётов обсудим позже, после проработки данных; пока пользователь поручил готовить широкую полезную структуру самостоятельно. По поручению пользователя [для прогресса выбран PG1](docs/resolved/progress/README.md); [для Общих выбран CG3](docs/resolved/general-scoring/README.md), остальные параметры определены по поручению пользователя. [Лидерборд](docs/resolved/leaderboard/README.md): LB2 по умолчанию, LB1 для большой группы, LB3 для истории.


Принятые решения и правила ведения обсуждений — в [журнале решений](docs/decisions.md).
