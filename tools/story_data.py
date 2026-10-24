# Builds guide/bosses.json, the teams of the story battles (gym leaders, rivals, Team Rocket
# executives, Elite Four...) that guide/story.json points at by trainer id. The teams come from the
# pret/pokeheartgold decompilation; the step text in guide/story.json is written by hand.
#
#   git clone --depth 1 https://github.com/pret/pokeheartgold
#   python3 tools/story_data.py path/to/pokeheartgold > guide/bosses.json
import json, re, sys
from pathlib import Path

root = Path(sys.argv[1])
here = Path(__file__).resolve().parent.parent
story = json.loads((here / "guide/story.json").read_text())

ids = set()
for step in story["steps"]:
    for b in step.get("boss", []):
        t = b["t"]
        ids.update(t if isinstance(t, list) else [t])

species = {m.group(1): int(m.group(2)) for m in
           re.finditer(r"#define SPECIES_(\w+)\s+(\d+)", (root / "include/constants/species.h").read_text())}
NAMES = {"NIDORAN_F": "Nidoran♀", "NIDORAN_M": "Nidoran♂", "MR_MIME": "Mr. Mime", "MIME_JR": "Mime Jr.",
         "FARFETCHD": "Farfetch'd", "HO_OH": "Ho-Oh", "PORYGON_Z": "Porygon-Z"}
trainers = json.loads((root / "files/poketool/trainer/trainers.json").read_text())["trainers"]

out = {}
for i in sorted(ids):
    party = []
    for p in trainers[i]["party"]:
        key = p["species"][len("SPECIES_"):]
        party.append([species[key], NAMES.get(key, key.capitalize()), p["level"]])
    out[str(i)] = party
print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
