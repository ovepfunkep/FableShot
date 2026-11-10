// Own FableShot debug database only. Preserve a stopped db/WAL/SHM set outside the phone.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const serial=process.argv[2];
if(!serial)throw new Error('Pass the explicitly selected ADB serial');
const pkg=process.argv[3]??'app.fableshot.android.dev';
const appNames={
  'app.fableshot.android.dev':'FableShot',
  'app.fableshot.android.verification':'FableShot-Test',
};
if(!Object.hasOwn(appNames,pkg))throw new Error('Expected an installed FableShot debug or test package');
const appName=appNames[pkg];
const config=JSON.parse(fs.readFileSync(path.join(root,'.tools/android-toolchain.json'),'utf8').replace(/^\uFEFF/,''));
const adb=path.join(config.SdkRoot,'platform-tools/adb.exe');
const directory=path.join(root,'.tools/backups',appName+'-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(directory,{recursive:true});
function run(args,binary=false){return execFileSync(adb,['-s',serial,...args],{encoding:binary?undefined:'utf8',timeout:30000,maxBuffer:256*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']});}
run(['shell','am','force-stop',pkg]);
const files=[];
let selection={current:'legacy',previous:null};
const selectionPath='files/diary-generations/selection.json';
let hasSelection=false;
try{run(['shell','run-as',pkg,'ls',selectionPath]);hasSelection=true;}
catch(error){if(!String(error.stderr).includes('No such file or directory'))throw error;}
if(hasSelection){
  const raw=run(['exec-out','run-as',pkg,'cat',selectionPath]);
  if(raw.length>4096)throw Error('Invalid diary selection');
  selection=JSON.parse(raw);
  const valid=id=>id==='legacy'||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  if(selection.version!==1||!valid(selection.current)||(selection.previous!==null&&!valid(selection.previous)))throw Error('Invalid diary selection');
}
const generation=selection.current==='legacy'?null:'files/diary-generations/'+selection.current;
const sources=[...['fableshot.db','fableshot.db-wal','fableshot.db-shm','fableshot-equipment.db','fableshot-equipment.db-wal','fableshot-equipment.db-shm'].map(name=>({name,remote:generation?generation+'/'+name.replace('fableshot-equipment.db','equipment.db').replace('fableshot.db','journal.db'):'databases/'+name})),{name:'fableshot_preferences.preferences_pb',remote:generation?generation+'/preferences.preferences_pb':'files/datastore/fableshot_preferences.preferences_pb'}];
const importsPath=generation?generation+'/imports':'files/imports';
try {
  const names=run(['shell','run-as',pkg,'ls',importsPath]).split(/\r?\n/).filter(Boolean);
  for(const name of names){if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv\.gz$/.test(name))sources.push({name:'import-'+name,remote:importsPath+'/'+name});}
}catch(error){if(!String(error.stderr).includes('No such file or directory'))throw error;}
for(const {name,remote} of sources){
  try{run(['shell','run-as',pkg,'ls',remote]);}
  catch(error){if(name!=='fableshot.db'&&String(error.stderr).includes('No such file or directory'))continue;throw new Error('Could not verify availability of own database file '+name);}
  const buffer=run(['exec-out','run-as',pkg,'cat',remote],true);
  if(name==='fableshot.db'&&buffer.length===0)throw new Error('Empty primary database');
  fs.writeFileSync(path.join(directory,name),buffer);
  files.push({name,remote,bytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex')});
}
const version=run(['shell','dumpsys','package',pkg]).match(/versionName=(\S+)/)?.[1]??'unknown';
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({package:pkg,version,createdUtc:new Date().toISOString(),state:'copied_not_verified',generationSelection:selection,sourceFilesIncluded:true,files},null,2));
console.log(JSON.stringify({directory,version,files:files.map(f=>({name:f.name,bytes:f.bytes}))}));
