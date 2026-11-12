# FableShot

Android-дневник стрельбы из лука: Kotlin, Jetpack Compose, Room.

Для продолжения разработки: [текущая очередь](docs/work-queue.md), затем спецификация и код затронутой функции.

- [План для заказчика: выполнено, предстоит, отложено](PRODUCT_ROADMAP.md).
- [Спецификации по функциям](docs/README.md).
- [Технический план](DEVELOPMENT_PLAN.md).
- [Архив завершённых обсуждений и журналов](docs/archive/README.md) — только для конкретной исторической проверки.

## Сборка

Нужны JDK 17 и Android SDK 36. Открыть `android` в Android Studio или указать SDK через `ANDROID_HOME` / `android/local.properties`:

```powershell
cd android
./gradlew.bat assembleDebug assembleVerification testDebugUnitTest
```

В Linux/macOS — `./gradlew` с теми же задачами. [Подробности и варианты приложения](android/README.md). Локальный Windows-скрипт `scripts/android-build.ps1` использует существующий инструментарий из `.tools`; обычному Gradle он не нужен.

Оба готовых APK находятся в `artifacts/FableShot-debug.apk` и `artifacts/FableShot-test.apk`. Личные дневники, резервные копии, экспорты и ключи не входят в Git. [Проверочные данные](docs/fixtures/README.md) синтетические.
