# FableShot

Native Android app: Kotlin, Compose, Room. Work in this checkout.

- For any UI/UX work, read [Ivan's UX/UI preferences](docs/design/ivan-ux-ui.md) once and apply them to affected screens: compact icon/value grids, one clear hierarchy, no repeated context or text piles, explanations beside headings, stable dimensions, and simple dismissible selectors. New explicit user feedback takes priority.

- For development or continuation, read `docs/work-queue.md` once. Then read only the affected feature spec, interfaces and tests. Plans, decisions, resolved topics and verification history are references, not a mandatory reading list.
- Latest user instructions govern scope. The queue owns current state, work in progress and the next task; feature specs own requirements. Plans describe overall product scope. Do not infer that source code was installed or verified.
- Deliver a bounded, useful user workflow. Batch related code and meaningful tests before building. Continue the roadmap only within an authorized development task; revisit working features for user feedback or a demonstrated defect.
- Search relevant directories with `rg`; return bounded fragments. Keep full logs in `artifacts/`. Respect `.gitignore`; inspect ignored files only for a specific diagnosis.
- Build from the root with `./scripts/android-build.ps1 -Tasks @('assembleDebug')`; use `testDebugUnitTest` for affected JVM tests and `assembleDebugAndroidTest` when device tests changed. Run checks appropriate to the risk. Re-run after a fix or new evidence, not an unchanged success. Build-count targets never excuse broken code.
- Keep meaningful migration, import, archive and scoring checks. UI checks exercise the affected user path. Never clear the personal diary or run `PersistenceSmokeTest`; verify data changes on isolated databases and verified copies first.
- At a checkpoint, update the queue once: current source/device state, unfinished work, checks and next step. Update specs for changed contracts; update large plans at milestones. Link logs instead of copying them into several documents.
- Keep Kotlin readable; avoid compressing whole functions onto one line. No unrelated formatting or cosmetic expansion.
- Do not commit, publish, create chats/worktrees, contact others or connect paid services without an explicit request. Leave the old web demo and its images alone.

## Параллельные агенты

- Всегда запускай параллельных агентов, когда есть независимые содержательные подзадачи и это ускоряет работу или улучшает проверку результата. Принимай это решение самостоятельно в рамках текущей задачи, без отдельного запроса пользователя.
- Делегируй конкретные подзадачи: исследование отдельных компонентов, реализацию независимых частей, проверку тестов или ревью. Каждому агенту задавай цель, необходимый контекст, границы изменений и ожидаемый результат.
- Во время работы агентов продолжай собственную независимую часть задачи. Не дублируй их работу и не запускай агентов для формальности, тривиальных действий или шагов, которые зависят от ещё не полученных результатов.
- При общей рабочей копии распределяй изменения по непересекающимся файлам или областям ответственности. Зависимые изменения и итоговую интеграцию выполняй последовательно; сохраняй правки пользователя и других агентов.
- Основной агент отвечает за итог: проверяет результаты делегирования, разрешает противоречия, объединяет изменения и выполняет необходимые общие проверки. Отчёт подагента сам по себе не подтверждает готовность задачи.
