"""Compare verified schema-1 and schema-2 working snapshots, never their preserved originals."""
from pathlib import Path
import json
import sqlite3
import sys

root=Path(__file__).resolve().parents[1]
allowed=(root/'.tools/backups').resolve()
def open_verified(argument,version):
    folder=Path(argument).resolve()
    if not folder.is_relative_to(allowed):raise SystemExit('Project backup directory required')
    manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    if manifest['state']!=f'verified_schema_{version}':raise SystemExit('Verify both backups first')
    working=manifest['verification']['workingCopy']
    if Path(working).name!=working:raise SystemExit('Invalid working copy name')
    fixture=folder/working/f'fableshot-fixture-v{version}.db'
    return sqlite3.connect(f'file:{fixture.as_posix()}?mode=ro',uri=True)

def version(argument):
    folder=Path(argument).resolve()
    if not folder.is_relative_to(allowed):raise SystemExit('Project backup directory required')
    return json.loads((folder/'manifest.json').read_text(encoding='utf-8'))['verification']['schemaVersion']
old_version=version(sys.argv[1]);new_version=version(sys.argv[2])
if (old_version,new_version) not in {(1,2),(1,3),(2,3),(3,3),(3,4),(4,4),(4,5),(5,5),(5,6),(6,6),(6,7),(7,7),(7,8),(8,8),(8,9),(9,9),(9,10),(10,10)}:raise SystemExit('Unsupported comparison')
old=open_verified(sys.argv[1],old_version)
new=open_verified(sys.argv[2],new_version)
def equal(label,left,right):
    if list(old.execute(left))!=list(new.execute(right)):raise SystemExit(label+' differs after migration')
if old_version==1:
    equal('Sessions','SELECT id,title,startedAt,state,completedAt FROM sessions ORDER BY id','SELECT id,title,startedAtMs,state,completedAtMs FROM sessions ORDER BY id')
    equal('Conditions','SELECT id,distanceMeters,targetDiameterMm,arrowsPerEnd,profileId FROM sessions ORDER BY id','SELECT sessionId,distanceMeters,targetDiameterMm,defaultArrowsPerEnd,targetProfileId FROM blocks WHERE ordinal=0 ORDER BY sessionId')
    equal('Ends','SELECT id,sessionId,number-1,plannedCount,closed FROM ends ORDER BY id',"SELECT e.id,b.sessionId,e.ordinal,e.plannedCount,CASE e.state WHEN 'closed' THEN 1 ELSE 0 END FROM ends e JOIN blocks b ON e.blockId=b.id ORDER BY e.id")
    equal('Shots','SELECT id,endId,inputIndex,points,x,y,origin,createdAt,revision FROM shots ORDER BY id',"SELECT id,endId,inputIndex,points,x,y,CASE scoreSource WHEN 'target_computed' THEN 'target' WHEN 'numeric_entry' THEN 'numeric' WHEN 'manual_edit' THEN 'manual' END,createdAtMs,revision FROM shots ORDER BY id")
    if new.execute('SELECT COUNT(*) FROM sessions WHERE timeZoneId IS NOT NULL OR localDate IS NOT NULL').fetchone()[0]:raise SystemExit('Migration invented calendar data')
    if new.execute('SELECT COUNT(*) FROM unscored_counts').fetchone()[0]:raise SystemExit('Migration invented unscored volume')
    checks=['sessions','conditions','ends','shots','unknowns']
else:
    checks=['sessions','blocks','ends','shots','unscored_counts','mutation_receipts']
    if old_version>=3:checks+=['import_batches','imported_groups','imported_rows','imported_end_sources']
    if old_version>=4:checks+=['progress_baselines']
    if old_version>=5:checks+=['session_plans']
    if old_version>=6:checks+=['technique_documents','technique_versions','technique_uses']
    if old_version>=8:checks+=['rank_assignments']
    if old_version>=9:checks+=['diary_notes']
    if old_version>=10:checks+=['achievement_enrollments','achievement_grants']
    for table in checks:
        fields=[row[1] for row in old.execute(f'PRAGMA table_info({table})')]
        projection=','.join('"'+field+'"' for field in fields)
        equal(table,f'SELECT {projection} FROM {table} ORDER BY 1',f'SELECT {projection} FROM {table} ORDER BY 1')
    if old_version==6 and new_version==7:
        if new.execute('SELECT COUNT(*) FROM session_plans WHERE roundCount<>1').fetchone()[0]:
            raise SystemExit('Legacy plans gained invented rounds')
        checks+=['legacy_round_count_defaults']
    if old_version==7 and new_version==8:
        if new.execute('SELECT COUNT(*) FROM rank_assignments').fetchone()[0]:
            raise SystemExit('Migration invented assigned ranks')
        checks+=['no_invented_assigned_ranks']
    if old_version==8 and new_version==9:
        if new.execute('SELECT COUNT(*) FROM diary_notes').fetchone()[0]:
            raise SystemExit('Migration invented diary notes')
        checks+=['no_invented_diary_notes']
    if old_version==9 and new_version==10:
        for table in ('achievement_enrollments','achievement_grants'):
            if new.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]:
                raise SystemExit('Migration invented achievement evidence or awards')
        checks+=['no_invented_achievement_enrollments','no_invented_achievement_grants']
summary={'status':'exact_primary_data_match','fromVersion':old_version,'toVersion':new_version,'checks':checks,'shots':new.execute('SELECT COUNT(*) FROM shots').fetchone()[0],'points':new.execute('SELECT COALESCE(SUM(points),0) FROM shots').fetchone()[0]}
target=root/(f'artifacts/verification/primary-v{old_version}-v{new_version}.json' if new_version>=5 else 'artifacts/verification/f03/primary-transfer.json' if new_version==2 else 'artifacts/verification/f04/primary-transfer.json')
target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary))
