package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.*
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

/** Definitions are native accessible links inside ordinary text, never separate chips. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GlossaryText(text: String, terms: Map<String,String>, modifier: Modifier = Modifier, onTermClick: ((String)->Unit)? = null, style: TextStyle = androidx.compose.material3.LocalTextStyle.current, overflow: androidx.compose.ui.text.style.TextOverflow = androidx.compose.ui.text.style.TextOverflow.Clip, softWrap: Boolean = true, maxLines: Int = Int.MAX_VALUE, minLines: Int = 1, onLayout: ((TextLayoutResult)->Unit)? = null) {
    val accent=MaterialTheme.colorScheme.primary
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    var selected by rememberSaveable(text) { mutableStateOf<String?>(null) }
    val canonical=GlossaryRegistry.matching(text)
    val definitions=(terms+canonical).mapValues { (term,definition) ->
        val context=terms[term].orEmpty()
        if(term in canonical && context.isNotBlank() && context!=definition) definition+"\n\n"+context else definition
    }
    val ranges=buildList<Triple<Int,Int,String>> {
        definitions.keys.sortedByDescending { it.length }.forEach { term ->
            var cursor=0
            while(cursor<text.length) {
                val start=text.indexOf(term,cursor,ignoreCase=true)
                if(start<0) break
                val end=start+term.length
                val boundary=(start==0 || !text[start-1].isLetterOrDigit()) && (end==text.length || !text[end].isLetterOrDigit())
                if(boundary && none { start<it.second && end>it.first }) add(Triple(start,end,term))
                cursor=end
            }
        }
    }.sortedBy { it.first }
    val annotated=buildAnnotatedString {
        append(text)
        ranges.forEach { (start,end,term) ->
            addLink(LinkAnnotation.Clickable(term,TextLinkStyles(style=SpanStyle(color=accent,textDecoration=TextDecoration.None))) {
                if(onTermClick!=null) onTermClick(term) else selected=term
            },start,end)
        }
    }
    androidx.compose.material3.Text(annotated,modifier.drawBehind {
        layout?.let { result -> ranges.forEach { (start,end,_) ->
            for(line in result.getLineForOffset(start)..result.getLineForOffset(end-1)) {
                val first=maxOf(start,result.getLineStart(line))
                val last=minOf(end,result.getLineEnd(line,visibleEnd=true))-1
                if(last>=first) drawLine(accent,
                    Offset(result.getBoundingBox(first).left,result.getLineBottom(line)-1.dp.toPx()),
                    Offset(result.getBoundingBox(last).right,result.getLineBottom(line)-1.dp.toPx()),
                    strokeWidth=1.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(),3.dp.toPx())))
            }
        } }
    },style=style,overflow=overflow,softWrap=softWrap,maxLines=maxLines,minLines=minLines,onTextLayout={layout=it;onLayout?.invoke(it)})
    selected?.let { term ->
        ModalBottomSheet(onDismissRequest={selected=null}) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                Row {
                    androidx.compose.material3.Text(term,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                }
                androidx.compose.material3.Text(definitions[term].orEmpty())
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
fun TermHelp(term: String, explanation: String) {
    val sentence=when {
        term=="Карта попаданий" -> "$term по выбранным тренировкам."
        term=="Распределение попаданий" -> "$term по зонам мишени."
        term=="База сравнения" -> "$term: похожие предыдущие занятия."
        term=="Процентные пункты" -> "$term показывают изменение доли попаданий."
        term=="Десятка и X" -> "$term зависят от правил выбранной мишени."
        term=="Разброс RMS" -> "$term измеряется относительно средней точки."
        term.contains("Прогресс",ignoreCase=true) -> "$term относительно обычного результата."
        term.contains("кучност",ignoreCase=true) -> "$term отмеченных попаданий."
        else -> "Текущий режим: $term."
    }
    GlossaryText(sentence,mapOf(term to explanation))
}
