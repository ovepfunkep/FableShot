"""Instantiate bundled OFL Manrope so OEM variable-font handling cannot flatten weights."""
from pathlib import Path
import hashlib
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools' / 'font-tools'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

directory = root / 'android/app/src/main/res/font'
source = directory / 'manrope_variable.ttf'
expected = '3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6'
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise SystemExit('Unexpected font source. Review source and license before updating the hash.')
for weight in (400, 500, 600, 700, 800):
    font = TTFont(source)
    if not all(ord(c) in font.getBestCmap() for c in 'СтрельбаЁй'):
        raise SystemExit('Required Cyrillic glyphs are missing')
    instance = instantiateVariableFont(font, {'wght': weight}, inplace=True, updateFontNames=True)
    target = directory / f'manrope_{weight}.ttf'
    instance.save(target)
    print(target.name, len(target.read_bytes()), hashlib.sha256(target.read_bytes()).hexdigest())
