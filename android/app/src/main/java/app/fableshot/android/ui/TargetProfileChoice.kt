package app.fableshot.android.ui

import app.fableshot.android.ui.ScaledModalBottomSheet as ModalBottomSheet

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.fableshot.android.R
import app.fableshot.android.domain.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun TargetProfileChoice(selected:String,compact:Boolean=false,enabled:Boolean=true,onSelect:(TargetProfile)->Unit) {
    var open by remember { mutableStateOf(false) }
    if(compact) ConditionRow("Мишень",TargetCatalog.find(selected)?.title?:stringResource(R.string.target_profile_title),
        Glyph.Target,{open=true},Modifier.testTag("target-profile-choice"),enabled)
    else OutlinedButton({open=true},Modifier.fillMaxWidth().testTag("target-profile-choice"),enabled=enabled) { Text(TargetCatalog.find(selected)?.title?:stringResource(R.string.target_profile_title)) }
    if(open)ModalBottomSheet(onDismissRequest={open=false}) {
        Text(stringResource(R.string.target_profile_title),Modifier.padding(horizontal=20.dp),style=MaterialTheme.typography.titleLarge)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            TargetCatalog.all.forEach{p->OutlinedCard({onSelect(p);open=false},Modifier.fillMaxWidth().testTag("target-profile-${p.id}")) {
                Row(Modifier.padding(12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Canvas(Modifier.size(48.dp)){drawTargetFace(center,size.minDimension*.46f,emptyList(),null,null,profile=p)}
                    Column {Text(p.title,style=MaterialTheme.typography.titleSmall);Text(if(p.diameters.isEmpty())stringResource(R.string.target_custom_size)else p.diameters.joinToString(" / "){"${it/10}"}+" см",style=MaterialTheme.typography.bodySmall)}
                }
            }}
            TermHelp("Десятка и X",stringResource(R.string.target_rules_help))
        }
    }
}
