package app.fableshot.android

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** Scoped-storage bridge for a single verified test copy. Never accepts a live diary name. */
class JournalFixtureTransferTest {
    @Test fun copyVerifiedExternalFixtureIntoIsolatedDatabasePath() {
        val args=InstrumentationRegistry.getArguments()
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name=requireNotNull(args.getString("backupFixtureName"))
        require(name.matches(Regex("fableshot-verification-backup-(?:v[1-8]-)?[a-zA-Z0-9-]+\\.db")))
        val checksum=requireNotNull(args.getString("fixtureSha256"))
        require(checksum.matches(Regex("[a-f0-9]{64}")))
        val directory=File(context.getExternalFilesDir("verification"),"fixtures")
        val source=File(directory,name)
        require(source.canonicalFile.parentFile==directory.canonicalFile && source.isFile && source.length() in 1..256L*1024*1024)
        fun hash(file:File):String {
            val digest=MessageDigest.getInstance("SHA-256")
            file.inputStream().use {input ->val buffer=ByteArray(8192);while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)}}
            return digest.digest().joinToString("") {"%02x".format(it)}
        }
        assertEquals(checksum,hash(source))
        val destination=context.getDatabasePath(name)
        require(!destination.exists())
        destination.parentFile!!.mkdirs()
        try {source.copyTo(destination);assertEquals(checksum,hash(destination))}
        catch(e:Exception) {destination.delete();throw e}
    }
}
