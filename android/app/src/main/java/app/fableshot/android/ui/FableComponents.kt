package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledDropdownMenu as DropdownMenu

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*

enum class Glyph { Home, History, Progress, Bow, Target, Arrow, Distance, Plus, Check, Back, Next, Settings, User, Trophy, Info, Download, Calendar, Close, Spark, Undo, Help, Notes, Trash, More, Edit, Start, Filters, Book, Question, Timer, Podium, Award, Archive, Favorite, FavoriteFilled, Kit, Share }

@Composable
fun FableIcon(glyph: Glyph, modifier: Modifier = Modifier, tint: Color = LocalContentColor.current, description: String? = null) {
    Canvas(modifier.size(22.dp).then(if (description == null) Modifier else Modifier.semantics { contentDescription = description })) {
        val s = size.width / 24f
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        val stroke = Stroke(1.8f * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(tint, p(x1,y1), p(x2,y2), 1.8f * s, StrokeCap.Round)
        fun circle(x: Float, y: Float, radius: Float) = drawCircle(tint, radius * s, p(x,y), style = stroke)
        fun path(vararg values: Float, filled: Boolean = false) {
            val path = Path()
            path.moveTo(values[0] * s, values[1] * s)
            for (i in 2 until values.size step 2) path.lineTo(values[i] * s, values[i + 1] * s)
            if (filled) path.close()
            drawPath(path, tint, style = if (filled) Fill else stroke)
        }
        when (glyph) {
            Glyph.Share -> {
                circle(5f,12f,3f);circle(19f,5f,3f);circle(19f,19f,3f)
                line(8f,10.5f,16f,6.5f);line(8f,13.5f,16f,17.5f)
            }
            Glyph.Podium -> {
                path(2f,22f,2f,12f,8f,12f,8f,6f,16f,6f,16f,15f,22f,15f,22f,22f,2f,22f)
                line(8f,12f,8f,22f); line(16f,15f,16f,22f)
                path(11f,10f,12f,9f,12f,13f)
                path(4f,15f,6f,15f,6f,16f,4f,18f,6f,18f)
                path(18f,17f,20f,17f,20f,20f,18f,20f); line(19f,18.5f,20f,18.5f)
            }
            Glyph.Award -> {
                circle(12f,9f,6f); path(7f,14f,5f,22f,9f,20f,12f,22f,13f,15f)
                path(14f,15f,16f,22f,18f,19f,21f,19f,17f,13f)
            }
            Glyph.Archive -> {
                path(4f,8f,4f,21f,20f,21f,20f,8f)
                path(3f,3f,21f,3f,21f,8f,3f,8f,3f,3f); line(10f,12f,14f,12f)
            }
            Glyph.Favorite, Glyph.FavoriteFilled -> path(
                12f,2f,15f,8f,22f,9f,17f,14f,18f,21f,12f,18f,6f,21f,7f,14f,2f,9f,9f,8f,12f,2f,
                filled = glyph == Glyph.FavoriteFilled,
            )
            Glyph.Kit -> {
                path(3f,7f,21f,7f,21f,21f,3f,21f,3f,7f)
                path(8f,7f,8f,3f,16f,3f,16f,7f); line(3f,12f,21f,12f); line(10f,11f,14f,11f)
            }
            Glyph.Timer -> {
                circle(12f, 14f, 8f)
                line(9f, 2f, 15f, 2f)
                line(12f, 2f, 12f, 6f)
                line(18f, 6f, 20f, 4f)
                path(12f, 9f, 12f, 14f, 15f, 16f)
            }
            Glyph.Book -> {
                path(12f,6f,8f,4f,2f,4f,2f,19f,8f,19f,12f,21f,16f,19f,22f,19f,22f,4f,16f,4f,12f,6f)
                line(12f,6f,12f,21f)
            }
            Glyph.Question -> {
                path(8f,7f,9f,4f,14f,4f,17f,7f,16f,10f,12f,13f,12f,15f)
                drawCircle(tint,1f*s,p(12f,20f))
            }
            Glyph.Filters -> {
                line(3f,6f,21f,6f); line(3f,12f,21f,12f); line(3f,18f,21f,18f)
                circle(8f,6f,2f); circle(16f,12f,2f); circle(10f,18f,2f)
            }
            Glyph.Start -> {
                line(4f,20f,20f,4f)
                path(14f,4f,20f,4f,20f,10f)
                path(5f,13f,5f,19f,11f,19f)
                path(8f,10f,8f,16f,14f,16f)
            }
            Glyph.More -> {
                for (y in listOf(5f,12f,19f)) drawCircle(tint,1.6f*s,p(12f,y))
            }
            Glyph.Edit -> {
                path(4f,16f,16f,4f,20f,8f,8f,20f,4f,20f,4f,16f)
                line(13f,7f,17f,11f)
            }
            Glyph.Home -> { path(3f,10f,12f,3f,21f,10f); path(5f,9f,5f,21f,10f,21f,10f,15f,14f,15f,14f,21f,19f,21f,19f,9f) }
            Glyph.History -> { path(7f,3f,19f,3f,19f,21f,5f,21f,5f,5f); line(9f,9f,15f,9f); line(9f,13f,15f,13f); line(9f,17f,13f,17f) }
            Glyph.Progress -> { path(3f,3f,3f,21f,21f,21f); path(6f,16f,11f,11f,15f,14f,21f,6f) }
            Glyph.Bow -> { path(6f,2f,12f,5f,15f,9f,16f,12f,15f,15f,12f,19f,6f,22f); line(6f,2f,6f,22f); line(3f,12f,22f,12f); path(18f,9f,22f,12f,18f,15f) }
            Glyph.Target -> { circle(12f,12f,9f); circle(12f,12f,5f); circle(12f,12f,1f) }
            Glyph.Arrow -> { line(4f,20f,20f,4f); path(13f,4f,20f,4f,20f,11f); path(4f,15f,4f,20f,9f,20f) }
            Glyph.Distance -> {
                line(3f, 12f, 21f, 12f)
                path(7f, 8f, 3f, 12f, 7f, 16f)
                path(17f, 8f, 21f, 12f, 17f, 16f)
                line(3f, 4f, 3f, 6f)
                line(21f, 4f, 21f, 6f)
            }
            Glyph.Plus -> { line(12f,5f,12f,19f); line(5f,12f,19f,12f) }
            Glyph.Check -> path(5f,12f,10f,17f,20f,6f)
            Glyph.Back -> { path(14f,5f,7f,12f,14f,19f); line(7f,12f,21f,12f) }
            Glyph.Next -> path(9f,5f,16f,12f,9f,19f)
            Glyph.Settings -> {
                val gear = Path()
                for (tooth in 0 until 8) {
                    val profile = listOf(-22.5f to 8f, -12f to 8f, -12f to 10.5f, 12f to 10.5f, 12f to 8f, 22.5f to 8f)
                    profile.forEachIndexed { index, (angle, radius) ->
                        val radians = Math.toRadians((tooth * 45 + angle).toDouble())
                        val x = (12 + kotlin.math.cos(radians) * radius).toFloat() * s
                        val y = (12 + kotlin.math.sin(radians) * radius).toFloat() * s
                        if (tooth == 0 && index == 0) gear.moveTo(x,y) else gear.lineTo(x,y)
                    }
                }
                gear.close()
                drawPath(gear,tint,style=stroke)
                circle(12f,12f,3.5f)
            }
            Glyph.Help -> {
                circle(12f,12f,9f)
                path(9f,8f,10f,6.5f,13f,6.5f,15f,8f,15f,10f,12f,12f,12f,14f)
                drawCircle(tint,1f*s,p(12f,17f))
            }
            Glyph.Notes -> {
                path(6f,3f,20f,3f,20f,21f,6f,21f,6f,3f)
                line(3f,7f,8f,7f); line(3f,12f,8f,12f); line(3f,17f,8f,17f)
                line(11f,8f,16f,8f); line(11f,12f,16f,12f)
            }
            Glyph.Trash -> {
                path(5f,6f,7f,21f,17f,21f,19f,6f)
                line(3f,6f,21f,6f); path(9f,6f,9f,3f,15f,3f,15f,6f)
                line(10f,10f,10f,17f); line(14f,10f,14f,17f)
            }
            Glyph.User -> { circle(12f,8f,4f); path(4f,21f,5f,17f,8f,15f,16f,15f,19f,17f,20f,21f) }
            Glyph.Trophy -> { path(7f,3f,17f,3f,17f,11f,15f,14f,9f,14f,7f,11f,7f,3f); path(7f,5f,3f,5f,3f,9f,7f,11f); path(17f,5f,21f,5f,21f,9f,17f,11f); line(12f,14f,12f,20f); line(7f,21f,17f,21f) }
            Glyph.Info -> { circle(12f,12f,9f); line(12f,11f,12f,17f); drawCircle(tint,1f*s,p(12f,7f)) }
            Glyph.Download -> { path(7f,10f,12f,15f,17f,10f); line(12f,3f,12f,15f); path(3f,16f,3f,21f,21f,21f,21f,16f) }
            Glyph.Calendar -> { path(3f,6f,21f,6f,21f,21f,3f,21f,3f,6f); line(3f,11f,21f,11f); line(8f,3f,8f,8f); line(16f,3f,16f,8f) }
            Glyph.Close -> { line(6f,6f,18f,18f); line(18f,6f,6f,18f) }
            Glyph.Spark -> path(12f,2f,15f,9f,22f,12f,15f,15f,12f,22f,9f,15f,2f,12f,9f,9f,12f,2f)
            Glyph.Undo -> { path(8f,4f,3f,9f,8f,14f); path(3f,9f,15f,9f,19f,11f,20f,15f,18f,19f,14f,20f) }
        }
    }
}

@Composable
fun FablePrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: Glyph? = null, preserveDisabledAppearance: Boolean = false, singleLine: Boolean = false) {
    val visuals = LocalFableVisuals.current
    Button(onClick, modifier.heightIn(min = 56.dp), enabled, shape = RoundedCornerShape(18.dp), colors = ButtonDefaults.buttonColors(containerColor = visuals.action, contentColor = visuals.onAction, disabledContainerColor = if(preserveDisabledAppearance) visuals.action else Color.Unspecified, disabledContentColor = if(preserveDisabledAppearance) visuals.onAction else Color.Unspecified), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 14.dp)) {
        if (singleLine) Box(Modifier.weight(1f)) {
            FittedLine(text, MaterialTheme.typography.labelLarge, LocalContentColor.current, alignment = Alignment.Center)
        } else androidx.compose.material3.Text(text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f, fill = false))
        if (icon != null) { Spacer(Modifier.width(12.dp)); FableIcon(icon) }
    }
}

@Composable
fun FableCard(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.surface, geometry: GeometryPattern? = null, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(LocalFableVisuals.current.cardRadius), color = color, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.fableGeometry(compact = true, pattern = geometry).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
fun BlockHeading(title: String, icon: Glyph, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        FableIcon(icon, tint = MaterialTheme.colorScheme.primary)
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
fun Eyebrow(text: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) { Text(text.uppercase(), modifier, color = color, style = MaterialTheme.typography.labelSmall) }

@Composable
fun InfoCard(title: String, message: String, modifier: Modifier = Modifier, icon: Glyph = Glyph.Info) {
    FableCard(modifier, MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .6f)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FableIcon(icon, tint = MaterialTheme.colorScheme.primary)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Rare actions share one accessible entry point, instead of crowded button rows. */
@Composable
fun ActionMenu(label: String = "Действия", content: @Composable ColumnScope.() -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box {
        IconButton({ open = true }) { FableIcon(Glyph.More, description = label) }
        DropdownMenu(open, { open = false }) {
            Column(Modifier.widthIn(min=200.dp).padding(8.dp), verticalArrangement=Arrangement.spacedBy(8.dp)) {
                content()
            }
        }
    }
}
