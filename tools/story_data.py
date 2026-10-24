# Builds guide/bosses.json for the NEXT section: "teams" are the parties of the story battles (gym
# leaders, rivals, Team Rocket executives, Elite Four...) that guide/story.json points at by trainer id,
# "dex" maps each Pokémon named in the steps' catch lists to its National Dex number (for the sprite).
# Both come from the pret/pokeheartgold decompilation; the step text in guide/story.json is written by hand.
#
#   git clone --depth 1 https://github.com/pret/pokeheartgold
#   python3 tools/story_data.py path/to/pokeheartgold > guide/bosses.json
import json, re, sys
from pathlib import Path

root = Path(sys.argv[1])
here = Path(__file__).resolve().parent.parent
story = json.loads((here / "guide/story.json").read_text())

ids, names = set(), set()
for step in story["steps"]:
    for name, _ in step.get("catch", []):
        names.update(re.findall(r"[^{}|]+", name))
    for b in step.get("boss", []):
        t = b["t"]
        ids.update(t if isinstance(t, list) else [t])

species = {m.group(1): int(m.group(2)) for m in
           re.finditer(r"#define SPECIES_(\w+)\s+(\d+)", (root / "include/constants/species.h").read_text())}
NAMES = {"NIDORAN_F": "Nidoran♀", "NIDORAN_M": "Nidoran♂", "MR_MIME": "Mr. Mime", "MIME_JR": "Mime Jr.",
         "FARFETCHD": "Farfetch'd", "HO_OH": "Ho-Oh", "PORYGON_Z": "Porygon-Z"}
trainers = json.loads((root / "files/poketool/trainer/trainers.json").read_text())["trainers"]

out = {"teams": {}, "dex": {}}
for name in sorted(names):
    key = {v: k for k, v in NAMES.items()}.get(name, name.upper())
    out["dex"][name] = species[key]
for i in sorted(ids):
    party = []
    for p in trainers[i]["party"]:
        key = p["species"][len("SPECIES_"):]
        party.append([species[key], NAMES.get(key, key.capitalize()), p["level"]])
    out["teams"][str(i)] = party
print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
