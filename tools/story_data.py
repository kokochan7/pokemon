# Builds guide/bosses.json for the NEXT section: "teams" are the parties of the story battles (gym
# leaders, rivals, Team Rocket executives, Elite Four...) that guide/story.json points at by trainer id,
# "dex" maps each Pokémon named in the steps' catch lists to its National Dex number (for the sprite).
# Both come from the pret/pokeheartgold decompilation; the step text in guide/story.json is written by hand.
# Each team member also gets its weaknesses ({type: 2 or 4}) from its own types and ability with the Gen 4 type
# chart below, so the boss box's "Weakness" row matches the actual team, not just the gym's type.
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

personal = {e["species"]: e for e in
            json.loads((root / "files/poketool/personal/personal.json").read_text())["baseStats"]}

# Gen 4 type chart: attacking type -> (super effective on, not very effective on, no effect on).
# No Fairy type yet, and Steel still resists Ghost and Dark.
CHART = {
    "normal": ([], ["rock", "steel"], ["ghost"]),
    "fighting": (["normal", "ice", "rock", "dark", "steel"], ["poison", "flying", "psychic", "bug"], ["ghost"]),
    "flying": (["grass", "fighting", "bug"], ["electric", "rock", "steel"], []),
    "poison": (["grass"], ["poison", "ground", "rock", "ghost"], ["steel"]),
    "ground": (["fire", "electric", "poison", "rock", "steel"], ["grass", "bug"], ["flying"]),
    "rock": (["fire", "ice", "flying", "bug"], ["fighting", "ground", "steel"], []),
    "bug": (["grass", "psychic", "dark"], ["fire", "fighting", "poison", "flying", "ghost", "steel"], []),
    "ghost": (["psychic", "ghost"], ["dark", "steel"], ["normal"]),
    "steel": (["ice", "rock"], ["fire", "water", "electric", "steel"], []),
    "fire": (["grass", "ice", "bug", "steel"], ["fire", "water", "rock", "dragon"], []),
    "water": (["fire", "ground", "rock"], ["water", "grass", "dragon"], []),
    "grass": (["water", "ground", "rock"], ["fire", "grass", "poison", "flying", "bug", "dragon", "steel"], []),
    "electric": (["water", "flying"], ["electric", "grass", "dragon"], ["ground"]),
    "psychic": (["fighting", "poison"], ["psychic", "steel"], ["dark"]),
    "ice": (["grass", "ground", "flying", "dragon"], ["fire", "water", "ice", "steel"], []),
    "dragon": (["dragon"], ["steel"], []),
    "dark": (["psychic", "ghost"], ["fighting", "dark", "steel"], []),
}
# Gen 4 abilities that change how much a type hurts (Lightningrod and Storm Drain only redirect in Gen 4;
# Dry Skin's 1.25x fire isn't a type weakness, so only its water immunity counts).
ABILITY = {"LEVITATE": {"ground": 0}, "FLASH_FIRE": {"fire": 0}, "WATER_ABSORB": {"water": 0},
           "VOLT_ABSORB": {"electric": 0}, "MOTOR_DRIVE": {"electric": 0}, "DRY_SKIN": {"water": 0},
           "THICK_FAT": {"fire": 0.5, "ice": 0.5}, "HEATPROOF": {"fire": 0.5}}

def ability(key, mon):
    # Trainer Pokémon get their personality's low bit from 0x78/0x88 (even, so the first ability) unless
    # the party entry overrides it (src/trainer_data.c); none of these boss parties override gender.
    first, second = personal[key]["abilities"]
    return second if mon["abilityOverride"] == "TRPOKE_ABILITY_OVERRIDE_SECOND" and second != "ABILITY_NONE" else first

def weak(key, mon):
    types = {t[len("TYPE_"):].lower() for t in personal[key]["types"]}
    mods = ABILITY.get(ability(key, mon)[len("ABILITY_"):], {})
    out = {}
    for atk, (se, nve, none) in CHART.items():
        m = 1
        for t in types:
            m *= 2 if t in se else 0.5 if t in nve else 0 if t in none else 1
        m *= mods.get(atk, 1)
        if m > 1:
            out[atk] = int(m)
    return out

out = {"teams": {}, "dex": {}}
for name in sorted(names):
    key = {v: k for k, v in NAMES.items()}.get(name, name.upper())
    out["dex"][name] = species[key]
for i in sorted(ids):
    party = []
    for p in trainers[i]["party"]:
        key = p["species"][len("SPECIES_"):]
        party.append([species[key], NAMES.get(key, key.capitalize()), p["level"], weak(key, p)])
    out["teams"][str(i)] = party
print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
