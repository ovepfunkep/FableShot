# Android FableShot

Kotlin, Jetpack Compose, Room и DataStore. Текущее состояние и следующий шаг — в [очереди](../docs/work-queue.md). Ниже инструкции сборки.

## Сборка на текущем компьютере

Из корня проекта: ./scripts/android-build.ps1 -Tasks assembleDebug. Проверки: ./scripts/android-build.ps1 -Tasks testDebugUnitTest. Допускается передать несколько задач массивом PowerShell.

Локальные пути JDK/SDK/Gradle хранятся в исключённом из Git .tools/android-toolchain.json. Системная Java 8 и системный PATH не заменяются.

На этом Windows-компьютере путь исходников содержит кириллицу. Скрипт синхронизирует только каталог android в выделенную ASCII-папку сборки внутри настроенного toolchain и запускает Gradle там. Исходный проект не перемещается. Build-кэш не зеркалируется обратно. APK копируется в artifacts/FableShot-debug.apk, сгенерированные Room schemas/Gradle Wrapper — в исходный проект. Скрипт проверяет целевой путь перед синхронизацией с удалением устаревших файлов.

Закреплённые версии — в gradle/libs.versions.toml. Начальная комбинация подобрана под AGP 9.1.1 / Gradle 9.3.1 / JDK 17 / API 36; конкретный результат сборки и проверки телефона — в [журнале рабочего процесса](../docs/android-development-workflow.md).

