// Local migration verification; the primary database is never opened by this script's test.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const serial=process.argv[2];
const fixture=path.resolve(process.argv[3]||'');
const allowed=path.join(root,'.tools','backups')+path.sep;
const sourceVersion=path.basename(fixture).match(/^fableshot-fixture-v([12345678])\.db$/)?.[1];
if(!serial||!fixture.startsWith(allowed)||!sourceVersion)throw Error('Explicit serial and verified project fixture required');
const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(fixture)),'manifest.json'),'utf8'));
if(manifest.state!=='verified_schema_'+sourceVersion)throw Error('Verify the backup first');
const config=JSON.parse(fs.readFileSync(path.join(root,'.tools/android-toolchain.json'),'utf8'));
const adb=path.join(config.SdkRoot,'platform-tools','adb.exe');
const project=path.join(config.ToolchainRoot,'project');
const pkg='app.fableshot.android.dev';
const classes=process.argv[4]||(sourceVersion==='5'?'app.fableshot.android.JournalV5BackupCopyTest':sourceVersion==='4'?'app.fableshot.android.JournalV4BackupCopyTest':sourceVersion==='3'?'app.fableshot.android.JournalV3BackupCopyTest':sourceVersion==='2'?'app.fableshot.android.JournalV2BackupCopyTest':'app.fableshot.android.JournalMigrationTest,app.fableshot.android.JournalRepositoryTest,app.fableshot.android.JournalBackupCopyTest');
const name='fableshot-verification-backup-'+(sourceVersion==='1'?'':'v'+sourceVersion+'-')+crypto.randomUUID()+'.db';
const transfer='/sdcard/Android/data/'+pkg+'/files/verification/fixtures/'+name;
const run=(args,options={})=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,...options});
run(['install','--no-streaming','-r',path.join(project,'app/build/outputs/apk/debug/app-debug.apk')]);
run(['install','--no-streaming','-r',path.join(project,'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk')]);
run(['shell','am','force-stop',pkg]);
try {
    const bytes=fs.readFileSync(fixture);
    // ADB push preserves binary bytes on Windows; stdin/dd transfer proved unreliable.
    run(['shell','mkdir','-p','/sdcard/Android/data/'+pkg+'/files/verification/fixtures']);
    run(['push',fixture,transfer]);
    const transferred=run(['exec-out','cat',transfer],{encoding:null});
    if(transferred.length!==bytes.length||crypto.createHash('sha256').update(transferred).digest('hex')!==crypto.createHash('sha256').update(bytes).digest('hex'))throw Error('Transferred fixture differs from the verified local copy');
    const prepared=run(['shell','am','instrument','-w','-r','-e','class','app.fableshot.android.JournalFixtureTransferTest','-e','backupFixtureName',name,'-e','fixtureSha256',crypto.createHash('sha256').update(bytes).digest('hex'),pkg+'.test/androidx.test.runner.AndroidJUnitRunner']);
    if(!/OK \(1 test\)/.test(prepared))throw Error('Native isolated fixture copy failed: '+prepared);
    const output=run(['shell','am','instrument','-w','-r','-e','class',classes,'-e','backupFixtureName',name,pkg+'.test/androidx.test.runner.AndroidJUnitRunner']);
    const log=path.join(root,sourceVersion==='8'?'artifacts/verification/notes-copy.log':sourceVersion==='7'?'artifacts/verification/assigned-ranks-copy.log':sourceVersion==='5'?'artifacts/verification/technique-copy.log':sourceVersion==='4'?'artifacts/verification/plan-copy.log':sourceVersion==='3'?'artifacts/verification/pg1-copy.log':sourceVersion==='2'?'artifacts/verification/f04/v2-copy.log':'artifacts/verification/f03/journal.log');fs.mkdirSync(path.dirname(log),{recursive:true});fs.writeFileSync(log,output);
    process.stdout.write(output);
    if(!/OK \(\d+ tests?\)/.test(output))process.exitCode=1;
} finally {
    run(['shell','run-as',pkg,'rm','-f',...['','-wal','-shm'].map(s=>'databases/'+name+s)]);
    run(['shell','rm','-f',transfer]);
    // Opening the primary journal is a separate, explicitly gated operation.
}
