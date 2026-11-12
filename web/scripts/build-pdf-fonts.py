"""Create static instances of the existing OFL Manrope asset for PDF font subsetting."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

directory = Path(__file__).resolve().parent.parent / "public" / "fonts"
for weight, name in ((400, "regular"), (700, "bold")):
    font = TTFont(directory / "manrope.ttf")
    static = instantiateVariableFont(font, {"wght": weight}, inplace=False)
    static.save(directory / f"manrope-pdf-{name}.ttf")
