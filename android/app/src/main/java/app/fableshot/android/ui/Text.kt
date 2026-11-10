package app.fableshot.android.ui

import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit

/** App text resolves glossary entries centrally; numbers and ordinary text stay plain. */
@Composable
fun Text(
    text: String, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified, fontStyle: FontStyle? = null,
    fontWeight: FontWeight? = null, fontFamily: FontFamily? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified, textDecoration: TextDecoration? = null,
    textAlign: TextAlign? = null, lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip, softWrap: Boolean = true,
    maxLines: Int = Int.MAX_VALUE, minLines: Int = 1,
    onTextLayout: ((TextLayoutResult)->Unit)? = null, style: TextStyle = LocalTextStyle.current,
) {
    val terms=GlossaryRegistry.matching(text)
    val merged=style.merge(TextStyle(color=color,fontSize=fontSize,fontWeight=fontWeight,
        fontStyle=fontStyle,fontFamily=fontFamily,letterSpacing=letterSpacing,
        textDecoration=textDecoration,textAlign=textAlign ?: androidx.compose.ui.text.style.TextAlign.Unspecified,lineHeight=lineHeight))
    if(terms.isEmpty()) androidx.compose.material3.Text(text,modifier,style=merged,
        overflow=overflow,softWrap=softWrap,maxLines=maxLines,minLines=minLines,onTextLayout=onTextLayout)
    else GlossaryText(text,terms,modifier,style=merged,overflow=overflow,softWrap=softWrap,maxLines=maxLines,minLines=minLines,onLayout=onTextLayout)
}
