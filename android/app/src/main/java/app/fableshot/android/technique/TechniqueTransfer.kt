package app.fableshot.android.technique

import java.io.InputStream

private val techniquePhasePrefix = Regex("^\\s*\\d+[.)]\\s+")

/** Authored numbers may be measurements; only the text parser removes list syntax. */
internal fun techniqueListContent(line: String): String = line.trim()

internal fun techniqueStepLabel(step: TechniqueStep, phase: Int, number: Int): String =
    "$phase.$number ${techniqueListContent(step.short).ifBlank { "Пункт $number" }}"

internal fun techniqueSubpoints(step: TechniqueStep, phase: Int, number: Int): List<String> =
    (step.detail.lineSequence() + step.children.lineSequence()).map(String::trim).filter(String::isNotEmpty)
        .mapIndexed { index, line -> "$phase.$number.${index + 1} ${techniqueListContent(line)}" }.toList()

/** A single editable memo. JSON preserves every field; text is a convenient authoring format. */
object TechniqueTransfer {
    const val MAX_BYTES = 1_048_576
    const val MAX_TEXT_CHARS = 262_144

    fun read(input: InputStream): TechniqueText {
        val buffer = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        while (buffer.size() <= MAX_BYTES) {
            val size = input.read(chunk, 0, minOf(chunk.size, MAX_BYTES + 1 - buffer.size()))
            if (size < 0) break
            if (size > 0) buffer.write(chunk, 0, size)
        }
        val bytes = buffer.toByteArray()
        require(bytes.size <= MAX_BYTES) { "Файл памятки слишком большой" }
        val decoder = Charsets.UTF_8.newDecoder()
        val text = decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString().removePrefix("\uFEFF")
        return decode(text)
    }

    fun decode(raw: String): TechniqueText {
        require(raw.isNotBlank() && raw.length <= MAX_TEXT_CHARS) { "Памятка пуста или слишком большая" }
        return if (raw.trimStart().startsWith("{")) TechniqueText.parse(raw.trim(), allowDraft = true)
        else fromText(raw)
    }

    fun fromText(raw: String, fallbackTitle: String = "Импортированная памятка"): TechniqueText {
        require(raw.length <= MAX_TEXT_CHARS && raw.isNotBlank()) { "Введи текст памятки" }
        val phases = mutableListOf<TechniquePhase>()
        var title = fallbackTitle
        var context = ""
        val description = mutableListOf<String>()
        var discussed: String? = null
        val change = mutableListOf<String>()
        var readingChange = false
        var phaseTitle = "Алгоритм"
        var explicitPhase = false
        var steps = mutableListOf<TechniqueStep>()
        var lines = mutableListOf<String>()
        var question = mutableListOf<String>()
        var readingQuestion = false
        var visible = true
        val sourceLines = raw.replace("\r\n", "\n").replace('\r', '\n').lines()
        val hasPhaseHeadings = sourceLines.any { it.startsWith("## ") }
        val nestedPoint = Regex("^\\s*\\d+\\.\\d+\\.\\d+\\.\\s+(.+)$")
        val numberedStep = Regex("^\\s*(?:\\d+\\.\\d+\\.|\\d+[.)]|[-•])\\s+")
        fun flushStep() {
            val body = lines.joinToString("\n").trim()
            lines = mutableListOf()
            if (body.isBlank()) return
            val first = body.substringBefore('\n')
            val short = first.takeIf { it.length <= 200 }.orEmpty()
            val explanation = if (short.isEmpty()) body else body.substringAfter('\n', "").trim()
            val split = if (explanation.length > 4000) explanation.lastIndexOf('\n', 4000) else -1
            val detail = if (split >= 0) explanation.take(split) else explanation
            val children = if (split >= 0) explanation.drop(split + 1) else ""
            require(detail.length <= 4000 && children.length <= 4000) {
                "Пояснение и подпункты превышают допустимый объём."
            }
            steps += TechniqueStep(short = short, detail = detail, children = children,
                question = question.joinToString("\n").trim(), visible = visible)
            question = mutableListOf()
            readingQuestion = false
            visible = true
            require(steps.size <= 50) { "В фазе может быть не больше 50 пунктов" }
        }
        fun flushPhase() {
            flushStep()
            require(phaseTitle.length <= 100) { "Название фазы длиннее 100 знаков" }
            if (steps.isNotEmpty() || explicitPhase) phases += TechniquePhase(title = phaseTitle, steps = steps.toList())
            require(phases.size <= 30) { "В памятке может быть не больше 30 фаз" }
            steps = mutableListOf()
            explicitPhase = false
        }
        sourceLines.forEach { line ->
            when {
                line.startsWith("## ") -> {
                    flushPhase()
                    phaseTitle = line.drop(3).trim().replaceFirst(techniquePhasePrefix, "")
                    explicitPhase = true
                    readingChange = false
                }
                line.startsWith("# ") && phases.isEmpty() && steps.isEmpty() && lines.isEmpty() -> {
                    title = line.drop(2).trim()
                    require(title.length <= 100) { "Название памятки длиннее 100 знаков" }
                }
                line.startsWith("Контекст: ") && phases.isEmpty() && !explicitPhase && steps.isEmpty() && lines.isEmpty() ->
                    context = line.removePrefix("Контекст: ").trim()
                line.startsWith("Обсуждал с тренером: ") -> {
                    flushPhase()
                    discussed = line.removePrefix("Обсуждал с тренером: ").trim()
                }
                line.startsWith("Изменения версии: ") -> {
                    flushPhase()
                    change += line.removePrefix("Изменения версии: ")
                    readingChange = true
                }
                readingChange -> change += line
                hasPhaseHeadings && phases.isEmpty() && !explicitPhase && steps.isEmpty() && lines.isEmpty() ->
                    description += line
                nestedPoint.matches(line) && lines.isNotEmpty() -> {
                    lines += requireNotNull(nestedPoint.matchEntire(line)).groupValues[1]
                    readingQuestion = false
                }
                numberedStep.containsMatchIn(line) -> {
                    flushStep()
                    lines += line.replaceFirst(numberedStep, "")
                }
                line.startsWith("Уточнить с тренером: ") && lines.isNotEmpty() -> {
                    question += line.removePrefix("Уточнить с тренером: ")
                    readingQuestion = true
                }
                line == "Не показывать в кратком режиме" && lines.isNotEmpty() -> { visible = false; readingQuestion = false }
                readingQuestion -> question += line.trim()
                line.isBlank() -> flushStep()
                else -> lines += line.trim()
            }
        }
        flushPhase()
        require(phases.isNotEmpty()) { "В памятке нет пунктов" }
        return TechniqueText(title = title, context = context, description = description.joinToString("\n").trim(),
            phases = phases, discussed = discussed, change = change.joinToString("\n").trim())
            .also { TechniqueText.parse(it.json(), true) }
    }

    fun plainText(text: TechniqueText): String = buildString {
        appendLine("# ${text.title}")
        if (text.context.isNotBlank()) appendLine("Контекст: ${text.context}")
        if (text.description.isNotBlank()) appendLine(text.description)
        text.phases.forEachIndexed { phaseIndex, phase ->
            val phaseNumber = phaseIndex + 1
            appendLine(); appendLine("## $phaseNumber. ${techniqueListContent(phase.title)}")
            phase.steps.forEachIndexed { index, step ->
                // TXT terminates its outer number explicitly, distinguishing it from 2.5 cm.
                appendLine(techniqueStepLabel(step, phaseNumber, index + 1).replaceFirst(" ", ". "))
                techniqueSubpoints(step, phaseNumber, index + 1).forEach { appendLine(it.replaceFirst(" ", ". ")) }
                if (step.question.isNotBlank()) appendLine("Уточнить с тренером: ${step.question}")
                if (!step.visible) appendLine("Не показывать в кратком режиме")
                appendLine()
            }
        }
        text.discussed?.let { appendLine("Обсуждал с тренером: $it") }
        if (text.change.isNotBlank()) appendLine("Изменения версии: ${text.change}")
    }
}
