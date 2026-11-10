package app.fableshot.android.backup

/** Small strict JSON dialect: no duplicate keys, coercions, non-finite numbers or trailing data.
 * Integer tokens remain Long, including timestamps beyond Double's exact integer range. */
internal object ArchiveJson {
    fun parse(text: String): Any? = Parser(text).read()
    fun encode(value: Any?): String = buildString { appendValue(value) }
    private fun StringBuilder.appendValue(value: Any?) {
        when (value) {
            null -> append("null")
            is String -> {
                append('"')
                value.forEach { c -> when(c) {
                    '"' -> append("\\\""); '\\' -> append("\\\\")
                    else -> if(c.code < 32 || c.isSurrogate()) append("\\u" + c.code.toString(16).padStart(4,'0')) else append(c)
                } }; append('"')
            }
            is Boolean, is Int, is Long -> append(value.toString())
            is Float -> { if(!value.isFinite()) bad(); append(value.toString()) }
            is Double -> { if(!value.isFinite()) bad(); append(value.toString()) }
            is Map<*,*> -> { append('{');value.entries.forEachIndexed { i,e -> if(i>0)append(',');appendValue(e.key as? String ?: bad());append(':');appendValue(e.value) };append('}') }
            is List<*> -> { append('[');value.forEachIndexed{i,v->if(i>0)append(',');appendValue(v)};append(']') }
            else -> bad()
        }
    }
    private fun bad():Nothing=throw ArchiveInvalid("invalid_json")
    private class Parser(val source:String) {
        var at=0
        fun read():Any? { val value=value(0);white();if(at!=source.length)bad();return value }
        fun white(){while(at<source.length&&source[at] in " \t\r\n")at++}
        fun take(c:Char):Boolean {white();if(at<source.length&&source[at]==c){at++;return true};return false}
        fun value(depth:Int):Any? {
            if(depth>48)bad();white();if(at>=source.length)bad()
            return when(source[at]) {
                '{' -> {at++;val map=linkedMapOf<String,Any?>();if(!take('}'))while(true){white();if(at>=source.length||source[at]!='"')bad();val key=string();if(map.containsKey(key)||!take(':'))bad();map[key]=value(depth+1);if(take('}'))break;if(!take(','))bad()};map}
                '[' -> {at++;val list=mutableListOf<Any?>();if(!take(']'))while(true){list.add(value(depth+1));if(take(']'))break;if(!take(','))bad()};list}
                '"' -> string()
                't' -> literal("true",true)
                'f' -> literal("false",false)
                'n' -> literal("null",null)
                else -> number()
            }
        }
        fun literal(token:String,result:Any?):Any?{if(!source.startsWith(token,at))bad();at+=token.length;return result}
        fun string():String {
            at++;return buildString {
                while(true) {
                    if(at>=source.length)bad();val c=source[at++]
                    if(c=='"')break
                    if(c.code<32)bad()
                    if(c!='\\'){append(c);continue}
                    if(at>=source.length)bad()
                    when(val escaped=source[at++]) {
                        '"','\\','/' -> append(escaped)
                        'b'->append('\b');'f'->append('\u000c');'n'->append('\n');'r'->append('\r');'t'->append('\t')
                        'u'->{if(at+4>source.length)bad();val hex=source.substring(at,at+4);if(hex.any{it !in "0123456789abcdefABCDEF"})bad();append(hex.toInt(16).toChar());at+=4}
                        else->bad()
                    }
                }
            }.also { value ->
                var i=0;while(i<value.length){val c=value[i++];if(c.isHighSurrogate()){if(i==value.length||!value[i++].isLowSurrogate())bad()}else if(c.isLowSurrogate())bad()}
            }
        }
        fun number():Number {
            val start=at;if(at<source.length&&source[at]=='-')at++
            if(at>=source.length)bad()
            if(source[at]=='0')at++ else {if(source[at] !in '1'..'9')bad();while(at<source.length&&source[at] in '0'..'9')at++}
            var decimal=false
            fun digits(){val p=at;while(at<source.length&&source[at] in '0'..'9')at++;if(p==at)bad()}
            if(at<source.length&&source[at]=='.'){decimal=true;at++;digits()}
            if(at<source.length&&source[at] in "eE"){decimal=true;at++;if(at<source.length&&source[at] in "+-")at++;digits()}
            val token=source.substring(start,at)
            return if(decimal) token.toDoubleOrNull()?.takeIf{it.isFinite()}?:bad() else token.toLongOrNull()?:bad()
        }
    }
}

internal fun Any?.jsonObject():Map<String,Any?> {
    if(this !is Map<*,*> || keys.any{it !is String})throw ArchiveInvalid("expected_object")
    @Suppress("UNCHECKED_CAST") return this as Map<String,Any?>
}
internal fun Map<String,Any?>.exactKeys(keys:Set<String>) {if(this.keys!=keys)throw ArchiveInvalid("unexpected_json_fields")}
internal fun Map<String,Any?>.long(key:String):Long = this[key] as? Long ?: throw ArchiveInvalid("invalid_integer_$key")
internal fun Map<String,Any?>.string(key:String):String = this[key] as? String ?: throw ArchiveInvalid("invalid_string_$key")
