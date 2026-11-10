package app.fableshot.android.importing

import java.io.Reader

class CsvFormatException(message:String,val physicalLine:Int,val recordNumber:Int):IllegalArgumentException("$message (line $physicalLine, record $recordNumber)")
data class CsvRecord(val number:Int,val line:Int,val values:List<String>)

/** Streaming RFC-style quoted fields with a semicolon delimiter. Source values are never executed. */
object SemicolonCsv {
    fun records(reader:Reader,maxRecords:Int=250_001,maxColumns:Int=256,maxFieldChars:Int=256_000):Sequence<CsvRecord> = sequence {
        var line=1;var startLine=1;var number=1;var first=true;var previousCr=false;var skipLf=false
        var quoted=false;var afterQuote=false;var started=false
        val field=StringBuilder();val cells=mutableListOf<String>()
        fun invalid(message:String):Nothing=throw CsvFormatException(message,line,number)
        fun finishField(){if(cells.size>=maxColumns)invalid("Too many columns");cells.add(field.toString());field.setLength(0);started=false;afterQuote=false}
        fun finishRecord():CsvRecord{finishField();if(number>maxRecords)invalid("Too many records");return CsvRecord(number++,startLine,cells.toList()).also{cells.clear();startLine=line}}
        while(true) {
            val code=reader.read();if(code<0)break
            val c=code.toChar()
            if(first){first=false;if(c=='\uFEFF')continue}
            if(c=='\r')line++ else if(c=='\n'&&!previousCr)line++
            previousCr=c=='\r'
            if(skipLf){skipLf=false;if(c=='\n'){startLine=line;continue}}
            if(quoted) {
                if(c=='"'){quoted=false;afterQuote=true}else field.append(c)
            } else if(afterQuote) {
                when(c){'"'->{field.append(c);quoted=true;afterQuote=false};';'->finishField();'\r','\n'->{yield(finishRecord());skipLf=c=='\r'};else->invalid("Unexpected character after closing quote")}
            } else when(c) {
                '"'->{if(started)invalid("Quote inside unquoted field");quoted=true;started=true}
                ';'->finishField()
                '\r','\n'->{yield(finishRecord());skipLf=c=='\r'}
                else->{field.append(c);started=true}
            }
            if(field.length>maxFieldChars)invalid("Field is too long")
        }
        if(quoted)invalid("Unclosed quoted field")
        if(started||afterQuote||field.isNotEmpty()||cells.isNotEmpty())yield(finishRecord())
    }
}
