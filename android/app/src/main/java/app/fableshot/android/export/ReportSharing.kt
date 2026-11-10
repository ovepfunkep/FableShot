package app.fableshot.android.export

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

fun imageShareIntent(context:Context,files:List<File>):Intent {
    require(files.isNotEmpty())
    val uris=ArrayList(files.map {FileProvider.getUriForFile(context,context.packageName+".reports",it)})
    val send=Intent(if(uris.size==1)Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE)
        .setType("image/png").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    if(uris.size==1)send.putExtra(Intent.EXTRA_STREAM,uris.first()) else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris)
    send.clipData=ClipData.newRawUri("Тренировка FableShot",uris.first()).also {clip -> uris.drop(1).forEach {clip.addItem(ClipData.Item(it))}}
    return send
}

fun shareReportImages(context:Context,files:List<File>,title:String="Поделиться тренировкой") {
    context.startActivity(Intent.createChooser(imageShareIntent(context,files),title))
}
