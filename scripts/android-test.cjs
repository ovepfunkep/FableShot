// Explicit test classes only: never discover legacy tests that touch the personal diary.
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const [serial,classes,logName='instrumentation']=process.argv.slice(2);
if(!serial||!classes||!/^[A-Za-z0-9_,.#]+$/.test(classes)||!/^[a-z0-9-]+$/.test(logName))throw Error('SERIAL CLASSES LOG-SLUG required');
if(/PersistenceSmokeTest/.test(classes))throw Error('Legacy personal-diary smoke test is prohibited');
const config=JSON.parse(fs.readFileSync(path.join(root,'.tools/android-toolchain.json'),'utf8'));
const adb=path.join(config.SdkRoot,'platform-tools/adb.exe');
const run=args=>execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true});
// Reload instrumentation classes after replacing only the test APK; keep all app data.
run(['shell','am','force-stop','app.fableshot.android.dev']);
const output=run(['shell','am','instrument','-w','-r','-e','class',classes,'app.fableshot.android.dev.test/androidx.test.runner.AndroidJUnitRunner']);
const target=path.join(root,'artifacts/verification',logName+'.log');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);
const result=output.match(/Time: [\d.]+[\s\S]*?(?:OK \(\d+ tests?\)|Tests run: [^\r\n]+)/)?.[0];
console.log(result||output.slice(-4000));
if(!/OK \(\d+ tests?\)/.test(output)){process.exitCode=1;console.log(output.match(/(?:stack=|Error in )[\s\S]{0,3500}/)?.[0]||'Inspect saved log');}
