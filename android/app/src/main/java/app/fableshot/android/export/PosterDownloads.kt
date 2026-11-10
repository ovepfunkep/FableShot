package app.fableshot.android.export

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

internal suspend fun savePosterToDownloads(context:Context,pages:List<File>):List<Uri> = withContext(Dispatchers.IO) {
    require(pages.isNotEmpty())
    val resolver=context.contentResolver
    val collection=MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val created=mutableListOf<Uri>()
    try {
        val buffer=ByteArray(8192)
        for(page in pages) {
            ensureActive()
            val values=ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME,page.name)
                put(MediaStore.MediaColumns.MIME_TYPE,"image/png")
                put(MediaStore.MediaColumns.RELATIVE_PATH,"${Environment.DIRECTORY_DOWNLOADS}/FableShot/")
                put(MediaStore.MediaColumns.IS_PENDING,1)
            }
            val uri=resolver.insert(collection,values)?:throw IOException("Download could not be created")
            created.add(uri)
            page.inputStream().use {input ->
                val stream=resolver.openOutputStream(uri,"w")?:throw IOException("Download could not be opened")
                stream.use {output ->
                    while(true) {
                        ensureActive()
                        val size=input.read(buffer)
                        if(size<0)break
                        output.write(buffer,0,size)
                    }
                }
            }
        }
        // Publish only after all pages are written. Roll back this batch if any page fails.
        ensureActive()
        val published=ContentValues().apply {put(MediaStore.MediaColumns.IS_PENDING,0)}
        for(uri in created) {
            if(resolver.update(uri,published,null,null)!=1)throw IOException("Download could not be published")
        }
        created.toList()
    } catch(error:Exception) {
        for(uri in created) {
            try {resolver.delete(uri,null,null)}
            catch(cleanup:Exception) {error.addSuppressed(cleanup)}
        }
        throw error
    }
}
