package app.fableshot.android.export
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.util.UUID
object ReportImages {
 /** One page at a time: bounded bitmap memory, no page is silently dropped. */
 fun create(pdf:File,directory:File,check:()->Unit={}):List<File> {
  directory.mkdirs();val token=UUID.randomUUID().toString();val files=mutableListOf<File>();var bytes=0L
  try {
   PdfRenderer(ParcelFileDescriptor.open(pdf,ParcelFileDescriptor.MODE_READ_ONLY)).use{renderer->
    require(renderer.pageCount>0)
    repeat(renderer.pageCount){index->check();renderer.openPage(index).use{page->
     val bitmap=Bitmap.createBitmap(page.width*2,page.height*2,Bitmap.Config.ARGB_8888)
     val file=File(directory,"FableShot-$token-page-${(index+1).toString().padStart(4,'0')}.png");files.add(file)
     try{bitmap.eraseColor(Color.WHITE);page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_PRINT);file.outputStream().use{check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))}}finally{bitmap.recycle()}
     bytes+=file.length();require(bytes<=100L*1024*1024){"Image report exceeds 100 MiB"}
    }}
   };return files
  }catch(e:Exception){files.forEach{it.delete()};throw e}
 }
}
