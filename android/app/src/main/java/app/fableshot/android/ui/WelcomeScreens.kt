package app.fableshot.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import app.fableshot.android.R
import app.fableshot.android.data.ShotEntity
import app.fableshot.android.domain.TargetPoint
import app.fableshot.android.domain.TargetScoring
import java.util.UUID

@Composable
fun WelcomeScreen(onStart: () -> Unit, onImport: () -> Unit, onExample: () -> Unit, onSkip: () -> Unit) {
    val visuals = LocalFableVisuals.current
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    val reveal by animateFloatAsState(if (appeared) 1f else .88f, tween(if (visuals.motion) 420 else 0), label = "welcome-target")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).testTag("onboarding-screen"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { FableIcon(Glyph.Arrow, tint = MaterialTheme.colorScheme.primary); Text("FableShot", style = MaterialTheme.typography.titleLarge) }
            TextButton(onClick = onSkip, modifier = Modifier.testTag("onboard-skip")) { Text(stringResource(R.string.skip)) }
        }
        Box(Modifier.fillMaxWidth().height(172.dp).clip(RoundedCornerShape(32.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .55f))) {
            Canvas(Modifier.fillMaxSize().graphicsLayer { scaleX = reveal; scaleY = reveal }) {
                val c = Offset(size.width * .56f, size.height * .52f)
                val radius = size.height * .49f
                for (i in 1..3) drawCircle(visuals.information.copy(alpha = .14f), radius * (1f + i * .28f), c, style = Stroke(1.dp.toPx()))
                drawTargetFace(c, radius, emptyList(), null, null)
                val first = c + Offset(-radius * .06f, radius * .09f)
                val second = c + Offset(radius * .11f, -radius * .04f)
                listOf(first,second).forEach { p -> drawCircle(Color(0xFF14240D), 4.dp.toPx(), p); drawCircle(Color.White, 4.dp.toPx(), p, style=Stroke(1.5.dp.toPx())) }
                drawLine(visuals.action, Offset(size.width * .05f,size.height * .9f),Offset(size.width * .30f,size.height * .1f),7.dp.toPx(),StrokeCap.Round)
            }
        }
        Text(stringResource(R.string.onboard_title), style = MaterialTheme.typography.headlineLarge)
        Text(stringResource(R.string.onboard_subtitle), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Glyph.Target to R.string.onboard_marks, Glyph.Progress to R.string.onboard_growth, Glyph.Bow to R.string.onboard_club).forEach { (icon, label) ->
                Column(Modifier.weight(1f).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { FableIcon(icon, tint = MaterialTheme.colorScheme.primary); Text(stringResource(label), style = MaterialTheme.typography.labelMedium) }
            }
        }
        FablePrimaryButton(stringResource(R.string.new_session), onStart, Modifier.fillMaxWidth().testTag("onboard-start"), icon = Glyph.Arrow)
        OutlinedButton(onExample, Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("onboard-example"), shape = RoundedCornerShape(18.dp)) { Text(stringResource(R.string.onboard_try)) }
        TextButton(onImport, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("onboard-import")) { FableIcon(Glyph.Download); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.onboard_import)) }
        Text(stringResource(R.string.onboard_local), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
fun TargetTutorial(onFinish: () -> Unit, onHome: () -> Unit) {
    var step by rememberSaveable { mutableIntStateOf(0) }
    val shots = remember { mutableStateListOf<ShotEntity>() }
    var editing by remember { mutableStateOf<ShotEntity?>(null) }
    val display = shots.map { if (it.id == editing?.id) editing!! else it }
    val title = listOf(R.string.tutorial_aim_title,R.string.tutorial_zoom_title,R.string.tutorial_edit_title)[step]
    val hint = listOf(R.string.tutorial_aim_hint,R.string.tutorial_zoom_hint,R.string.tutorial_edit_hint)[step]
    fun score(point: TargetPoint) = app.fableshot.android.domain.TargetCatalog.practice.scoreShaft(point, 6.0, 400).points
    fun add(point: TargetPoint) { shots.add(ShotEntity("demo-${UUID.randomUUID()}","tutorial-end",shots.size,score(point),point.x,point.y,"target",0)) }
    LaunchedEffect(step) { if (step == 2 && shots.isEmpty()) add(TargetPoint(.08,.04)) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("tutorial-screen"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            Eyebrow(stringResource(R.string.tutorial_step,step+1))
            Text(stringResource(title),style=MaterialTheme.typography.headlineMedium)
            Text(stringResource(hint),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(color=MaterialTheme.colorScheme.surfaceVariant,shape=RoundedCornerShape(12.dp)) { Text(stringResource(R.string.tutorial_demo),Modifier.padding(horizontal=12.dp,vertical=8.dp),style=MaterialTheme.typography.labelMedium) }
        }
        TargetBoard(Modifier.fillMaxWidth(),"tutorial","tutorial-end",display,editing?.id,shots.size<3 || editing!=null,{ point ->
            if (editing != null) editing=editing!!.copy(x=point.x,y=point.y,points=score(point))
            else if (shots.size<3) add(point)
        })
        Column(Modifier.padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                (0..2).forEach { index ->
                    val shot=display.getOrNull(index)
                    OutlinedButton(onClick={if(shot!=null) editing=shot},enabled=shot!=null,modifier=Modifier.weight(1f).heightIn(min=52.dp).testTag("tutorial-shot-$index"),shape=RoundedCornerShape(14.dp)) { Text(shot?.points?.let { if(it==0) "M" else it.toString() } ?: "·",style=MaterialTheme.typography.titleLarge) }
                }
            }
            if(editing!=null) Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                TextButton({editing=null},Modifier.weight(1f).heightIn(min=48.dp)) { Text(stringResource(R.string.cancel)) }
                FablePrimaryButton(stringResource(R.string.done),{val edited=editing!!; val index=shots.indexOfFirst{it.id==edited.id}; if(index>=0) shots[index]=edited;editing=null},Modifier.weight(1f),icon=Glyph.Check)
            } else OutlinedButton({if(shots.isNotEmpty()) shots.removeAt(shots.lastIndex)},enabled=shots.isNotEmpty(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)) { FableIcon(Glyph.Undo);Spacer(Modifier.width(8.dp));Text(stringResource(R.string.undo)) }
            FablePrimaryButton(stringResource(if(step==2) R.string.tutorial_finish else R.string.next),{if(step<2){step++;editing=null}else onFinish()},Modifier.fillMaxWidth().testTag("tutorial-next"),icon=Glyph.Arrow)
            TextButton(onHome,Modifier.fillMaxWidth().heightIn(min=48.dp)) { Text(stringResource(R.string.to_home)) }
        }
    }
}
