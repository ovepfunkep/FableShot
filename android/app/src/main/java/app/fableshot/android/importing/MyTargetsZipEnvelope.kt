package app.fableshot.android.importing

import java.io.File
import java.io.RandomAccessFile
import java.util.Locale

/** Validates the small supported ZIP envelope before Android's absolute-path ZIP callback runs. */
internal object MyTargetsZipEnvelope {
    fun normalize(source: File, destination: File, maxEntries: Int, checkCancelled: () -> Unit): Map<String, String> {
        // Only this private copy is changed. Original bytes remain the provenance/hash source.
        source.inputStream().use { input -> destination.outputStream().use { output ->
            val buffer = ByteArray(8192)
            var count = 0L
            while (true) {
                checkCancelled()
                val size = input.read(buffer)
                if (size < 0) break
                count += size
                if (count > MyTargetsReader.MAX_BYTES) throw ImportRejected("file_too_large")
                output.write(buffer, 0, size)
            }
        } }
        RandomAccessFile(destination, "rw").use { file ->
            fun invalid(): Nothing = throw ImportRejected("archive_corrupt")
            fun bytes(at: Long, count: Int): ByteArray {
                if (at < 0 || count < 0 || at > file.length() - count) invalid()
                file.seek(at)
                return ByteArray(count).also { file.readFully(it) }
            }
            val tailStart = (file.length() - 65557).coerceAtLeast(0)
            val tail = bytes(tailStart, (file.length() - tailStart).toInt())
            val endIndex = (tail.size - 22 downTo 0).firstOrNull { index ->
                u32(tail, index) == 0x06054b50L && index + 22 + u16(tail, index + 20) == tail.size
            } ?: invalid()
            val end = tail.copyOfRange(endIndex, endIndex + 22)
            if (u16(end, 4) != 0 || u16(end, 6) != 0 || u16(end, 8) != u16(end, 10)) invalid()
            val count = u16(end, 10)
            if (count > maxEntries) throw ImportRejected("archive_too_many_entries")
            val centralSize = u32(end, 12)
            val centralOffset = u32(end, 16)
            if (count == 0 || centralOffset + centralSize != tailStart + endIndex) invalid()
            val names = linkedMapOf<String, String>()
            val seen = mutableSetOf<String>()
            val ranges = mutableListOf<Pair<Long, Long>>()
            var cursor = centralOffset
            repeat(count) { index ->
                checkCancelled()
                val header = bytes(cursor, 46)
                if (u32(header, 0) != 0x02014b50L) invalid()
                val flags = u16(header, 8)
                val method = u16(header, 10)
                if (flags and (1 or 64 or 8192) != 0 || method !in setOf(0, 8))
                    throw ImportRejected("archive_unsupported_entry")
                val compressed = u32(header, 20)
                val expanded = u32(header, 24)
                val nameSize = u16(header, 28)
                val extraSize = u16(header, 30)
                val commentSize = u16(header, 32)
                val localOffset = u32(header, 42)
                if (u16(header, 34) != 0 || compressed == 0xffffffffL || expanded == 0xffffffffL ||
                    localOffset == 0xffffffffL || nameSize !in 1..240) invalid()
                val rawName = bytes(cursor + 46, nameSize)
                // All paths supported by this backup format are ASCII. Do not coerce malformed names.
                if (rawName.any { it.toInt() !in 32..126 }) throw ImportRejected("archive_unsafe_path")
                val original = rawName.toString(Charsets.US_ASCII)
                val name = original.removePrefix("/")
                if (name.any { it == '\\' || it == ':' } || name.split('/').any { it.isEmpty() || it == "." || it == ".." })
                    throw ImportRejected("archive_unsafe_path")
                if (name != "data.db" && !Regex("[A-Za-z0-9_-]+\\.(jpg|jpeg|png)", RegexOption.IGNORE_CASE).matches(name))
                    throw ImportRejected("archive_unsupported_entry")
                if (!seen.add(name.lowercase(Locale.ROOT))) throw ImportRejected("archive_duplicate_entry")
                val local = bytes(localOffset, 30)
                if (u32(local, 0) != 0x04034b50L || u16(local, 6) != flags || u16(local, 8) != method ||
                    u16(local, 26) != nameSize || !bytes(localOffset + 30, nameSize).contentEquals(rawName)) invalid()
                val dataStart = localOffset + 30 + nameSize + u16(local, 28)
                val dataEnd = dataStart + compressed
                if (dataEnd > centralOffset || localOffset >= centralOffset) invalid()
                if (flags and 8 == 0 && (u32(local, 14) != u32(header, 16) ||
                        u32(local, 18) != compressed || u32(local, 22) != expanded)) invalid()
                ranges.add(localOffset to dataEnd)
                // Preserve each name's byte length and all ZIP offsets. Names become inert aliases;
                // the checked original-to-alias map is the only source of the entry's meaning.
                val alias = "e" + index.toString(36).padStart(nameSize - 1, '0')
                if (alias.length != nameSize) invalid()
                names[alias] = name
                file.seek(cursor + 46); file.write(alias.toByteArray(Charsets.US_ASCII))
                file.seek(localOffset + 30); file.write(alias.toByteArray(Charsets.US_ASCII))
                cursor += 46 + nameSize + extraSize + commentSize
                if (cursor > centralOffset + centralSize) invalid()
            }
            if (cursor != centralOffset + centralSize) invalid()
            val ordered = ranges.sortedBy { it.first }
            if (ordered.zipWithNext().any { (left, right) -> left.second > right.first }) invalid()
            return names
        }
    }

    private fun u16(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 255) or ((bytes[offset + 1].toInt() and 255) shl 8)
    private fun u32(bytes: ByteArray, offset: Int): Long =
        (0..3).fold(0L) { value, byte -> value or ((bytes[offset + byte].toLong() and 255L) shl (8 * byte)) }
}
