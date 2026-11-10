"""Validate a separate working copy. Never open/mutate the preserved backup files."""
from pathlib import Path
import hashlib
import json
import shutil
import sqlite3
import sys
import uuid
import re
import gzip

root=Path(__file__).resolve().parents[1]
backup=Path(sys.argv[1]).resolve()
allowed=(root/'.tools/backups').resolve()
if not backup.is_relative_to(allowed):
    raise SystemExit('Backup must be inside this project backup directory')
manifest_path=backup/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
if manifest['package']!='app.fableshot.android.dev':
    raise SystemExit('Not a FableShot debug backup')
working=backup/('verification-'+uuid.uuid4().hex)
working.mkdir()
for record in manifest['files']:
    if record['name'] not in {'fableshot.db','fableshot.db-wal','fableshot.db-shm','fableshot-equipment.db','fableshot-equipment.db-wal','fableshot-equipment.db-shm','fableshot_preferences.preferences_pb'} and not re.fullmatch(r'import-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv\.gz',record['name']):
        raise SystemExit('Unexpected backup file')
    source=backup/record['name']
    if hashlib.sha256(source.read_bytes()).hexdigest()!=record['sha256']:
        raise SystemExit('Backup checksum mismatch')
    shutil.copy2(source,working/record['name'])
with sqlite3.connect(working/'fableshot.db') as db:
    integrity=[row[0] for row in db.execute('PRAGMA integrity_check')]
    if integrity!=['ok'] or list(db.execute('PRAGMA foreign_key_check')):
        raise SystemExit('Backup integrity or foreign key validation failed')
    version=db.execute('PRAGMA user_version').fetchone()[0]
    identity=db.execute('SELECT identity_hash FROM room_master_table WHERE id=42').fetchone()[0]
    if version not in (1,2,3,4,5,6,7,8,9,10):
        raise SystemExit('Unexpected journal schema version')
    schema_path=root/('android/app/schemas/app.fableshot.android.data.PracticeDatabase/1.json' if version==1 else f'android/app/schemas/app.fableshot.android.data.journal.JournalDatabase/{version}.json')
    expected=json.loads(schema_path.read_text(encoding='utf-8'))['database']['identityHash']
    if identity!=expected:
        raise SystemExit('Unexpected primary schema identity')
    counts={table:db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in ('sessions','ends','shots')}
    total=db.execute('SELECT COALESCE(SUM(points),0) FROM shots').fetchone()[0]
    if version>=3 and manifest.get('sourceFilesIncluded'):
        for source_path,expected_hash in db.execute('SELECT rawSourcePath,fileHash FROM import_batches'):
            if not re.fullmatch(r'imports/[0-9a-f-]{36}\.csv\.gz',source_path):
                raise SystemExit('Invalid import source path')
            digest=hashlib.sha256()
            size=0
            with gzip.open(working/('import-'+source_path.removeprefix('imports/')),'rb') as source:
                while chunk:=source.read(8192):
                    size+=len(chunk)
                    if size>25*1024*1024:
                        raise SystemExit('Import source too large')
                    digest.update(chunk)
            if digest.hexdigest()!=expected_hash:
                raise SystemExit('Import source checksum mismatch')
    if db.execute('SELECT COUNT(*) FROM shots WHERE (x IS NULL)!=(y IS NULL)').fetchone()[0]:
        raise SystemExit('Unpaired coordinates')
    fixture=working/f'fableshot-fixture-v{version}.db'
    with sqlite3.connect(fixture) as snapshot:
        db.backup(snapshot)
manifest.update(state=f'verified_schema_{version}',verification={'schemaVersion':version,'identityHash':identity,'integrity':'ok','rowCounts':counts,'pointsTotal':total,'workingCopy':working.name})
equipment=working/'fableshot-equipment.db'
if equipment.exists():
    with sqlite3.connect(equipment) as catalog:
        if list(catalog.execute('PRAGMA integrity_check'))!=[('ok',)] or list(catalog.execute('PRAGMA foreign_key_check')):
            raise SystemExit('Equipment copy is not valid')
        equipment_schema=json.loads((root/'android/app/schemas/app.fableshot.android.data.EquipmentDatabase/1.json').read_text(encoding='utf-8'))
        if catalog.execute('SELECT identity_hash FROM room_master_table WHERE id=42').fetchone()[0]!=equipment_schema['database']['identityHash']:
            raise SystemExit('Unexpected equipment schema')
        manifest['verification']['equipmentItems']=catalog.execute('SELECT COUNT(*) FROM equipment_items').fetchone()[0]
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'directory':str(backup),'state':manifest['state'],'rowCounts':counts,'pointsTotal':total,'fixture':str(fixture)}))
