# Builds guide/hgss.json, the per-map data behind the in-game guide panel, from a checkout of the
# pret/pokeheartgold decompilation (https://github.com/pret/pokeheartgold). Only game facts are
# extracted: map names, wild encounter tables, item balls, hidden items, trainers and their parties,
# exits, and which land-data blocks make up each map (the page reads the terrain itself from the ROM).
#
#   git clone --depth 1 https://github.com/pret/pokeheartgold
#   python3 tools/guide_data.py path/to/pokeheartgold > guide/hgss.json
import json, re, struct, sys
from pathlib import Path

root = Path(sys.argv[1])
read = lambda p: (root / p).read_text()

def defines(path, prefix):
    out = {}
    for m in re.finditer(rf"#define ({prefix}\w+)\s+(\d+)(?:\s*//\s*(\S+))?", read(path)):
        out[m.group(1)] = (int(m.group(2)), m.group(3))
    return out

FIX = {"Pokemon": "Pokémon", "Pkmn": "Pokémon", "Tm": "TM", "Hm": "HM", "Hp": "HP", "Pp": "PP", "Ss": "S.S.",
       "Elms": "Elm's", "Oaks": "Oak's", "Bills": "Bill's", "Kurts": "Kurt's", "Mr": "Mr.", "Gs": "GS",
       "1f": "1F", "2f": "2F", "3f": "3F", "4f": "4F", "5f": "5F", "6f": "6F", "7f": "7F", "8f": "8F",
       "9f": "9F", "10f": "10F", "11f": "11F", "B1f": "B1F", "B2f": "B2F", "B3f": "B3F", "B4f": "B4F", "B5f": "B5F",
       "Rf": "Roof", "Ne": "NE", "Nw": "NW", "Se": "SE", "Sw": "SW", "Of": "of", "Jp": "JP",
       "Pokecenter": "Pokémon Center", "Pokemart": "Poké Mart", "Poke": "Poké", "Sp": "Sp."}
def title(const, strip):
    words = const[len(strip):].split("_")
    words = [FIX.get(w.capitalize(), w.capitalize()) for w in words if w]
    words = [re.sub(r"^(Tm|Hm)(\d+)$", lambda m: m.group(1).upper() + m.group(2), w) for w in words]
    return " ".join(words)

SPECIES_NAMES = {"NIDORAN_F": "Nidoran♀", "NIDORAN_M": "Nidoran♂", "MR_MIME": "Mr. Mime", "MIME_JR": "Mime Jr.",
                 "FARFETCHD": "Farfetch'd", "HO_OH": "Ho-Oh", "PORYGON_Z": "Porygon-Z"}
species = {k: v[0] for k, v in defines("include/constants/species.h", "SPECIES_").items()}
def mon(const):
    key = const[len("SPECIES_"):]
    return species[const], SPECIES_NAMES.get(key, key.capitalize())

maps = defines("include/constants/maps.h", "MAP_")
mapsecs = {k: title(k, "MAPSEC_") for k in defines("include/constants/map_sections.h", "MAPSEC_")}
codes = {v[1][len("MAP_"):].lower() for v in maps.values() if v[1]}
items = set(defines("include/constants/items.h", "ITEM_"))
# TM_FOCUS_PUNCH ITEM_TM01 -> {"ITEM_TM01": "Focus Punch"}
tm_moves = {m.group(2): title(m.group(1), "")
            for m in re.finditer(r"#define (?:TM|HM)_(\w+)\s+(ITEM_[TH]M\d+)\b", read("include/constants/items.h"))}

# Map headers: wild encounter bank, zone events file and location (mapsec) per map.
headers = {}
for m in re.finditer(r"\[(MAP_\w+)\] = \{(.*?)\n\s*\},", read("src/data/map_headers.h"), re.S):
    body = m.group(2)
    f = lambda k: re.search(rf"\.{k} = (\w+)", body).group(1)
    headers[m.group(1)] = {"enc": f("wildEncounterBank"), "events": f("eventsBank"), "mapsec": f("mapsec"),
                           "matrix": int(re.match(r"NARC_map_matrix_map_matrix_(\d+)", f("matrixId")).group(1))}

enc_index = {}
for m in re.finditer(r"#define (ENCDATA_\w+)\s+ENCDATA\(_(\d+)\)", read("include/encounter_tables_narc.h")):
    enc_index[m.group(1)] = int(m.group(2))
enc_list = json.loads(read("files/fielddata/encountdata/gs_enc_data.json"))["encounters"]

def pick(v, ver):
    return v[ver] if isinstance(v, dict) and ver in v else v

LAND_RATE = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1]
SURF_RATE = [60, 30, 5, 4, 1]

def table(e, ver):
    """One version's encounters as {method: [[dex, name, minLv, maxLv, pct|None], ...]}.
    Grass differs by time of day, so it is split into grass_morn / grass_day / grass_nite."""
    out = {}
    def add(method, dex, name, lo, hi, pct):
        rows = out.setdefault(method, {})
        r = rows.setdefault(dex, [dex, name, lo, hi, 0 if pct is not None else None])
        r[2], r[3] = min(r[2], lo), max(r[3], hi)
        if pct is not None: r[4] += pct
    if e["land"]["rate"]:
        for i, s in enumerate(e["land"]["mons"]):
            lv = pick(s["level"], ver)
            for when in ("morn", "day", "nite"):
                dex, name = mon(pick(s["species"][when], ver))
                add("grass_" + when, dex, name, lv, lv, LAND_RATE[i])
    def simple(method, block, rates):
        if not block["rate"]: return
        for i, s in enumerate(block["mons"]):
            sp = pick(s["species"], ver)
            if sp in ("SPECIES_NONE", 0): continue
            lv = s["level"]
            lo, hi = pick(lv["min"], ver), pick(lv["max"], ver)
            dex, name = mon(sp)
            add(method, dex, name, lo, hi, rates[i] if rates else None)
    simple("surf", e["surf"], SURF_RATE)
    simple("rock", e["rock_smash"], None)
    for rod in ("old_rod", "good_rod", "super_rod"):
        simple(rod.replace("_rod", "rod"), e["fishing"][rod], None)
    return {method: sorted(rows.values(), key=lambda r: -(r[4] or 0)) for method, rows in out.items()}

def item_name(script, prefix):
    if not isinstance(script, str) or not script.startswith(prefix): return None
    parts = script[len(prefix):].split("_")
    while parts and parts[0] in codes: parts.pop(0)
    const = "ITEM_" + "_".join(parts).upper()
    if const not in items: return None
    return title(const, "ITEM_") + (" " + tm_moves[const] if const in tm_moves else "")

trainer_ids = {k: v[0] for k, v in defines("include/constants/trainers.h", "TRAINER_").items()}
trainer_data = json.loads(read("files/poketool/trainer/trainers.json"))["trainers"]
def trainer(script):
    """[class + name, [[dex, name, level], ...], trainer id] for a std_trainer(TRAINER_X) object."""
    if not isinstance(script, str): return None
    m = re.match(r"std_trainer\((TRAINER_\w+)\)", script)
    if not m or m.group(1) not in trainer_ids: return None
    tid = trainer_ids[m.group(1)]
    t = trainer_data[tid]
    who = (title(t["class"], "TRAINERCLASS_") + " " + t["name"].replace("{TRNAME}", "")).strip()
    return who, [[*mon(p["species"])[:2], p["level"]] for p in t["party"]], tid

# Map matrices: a grid of 32x32-tile blocks, each naming the map header it belongs to and the
# land-data block (terrain) it uses. Matrix 0 is the whole overworld.
def matrix(num):
    path = next((root / "files/fielddata/mapmatrix/map_matrix").glob(f"map_matrix_{num:04d}*.bin"))
    b = path.read_bytes()
    w, h, has_headers, has_alts, name_len = b[:5]
    c, n = 5 + name_len, b[0] * b[1]
    hdr = list(struct.unpack(f"<{n}H", b[c:c + 2 * n])) if has_headers else None
    c += 2 * n if has_headers else 0
    c += n if has_alts else 0
    models = list(struct.unpack(f"<{n}H", b[c:c + 2 * n]))
    return w, h, hdr, models
matrices = {}

DIRS = {(0, -1): "N", (0, 1): "S", (-1, 0): "W", (1, 0): "E"}

out = {}
for const, (num, code) in sorted(maps.items(), key=lambda kv: kv[1][0]):
    h = headers.get(const)
    if not h: continue
    # "New Bark Town" + "New Bark Elm's Lab 1F" -> place "Elm's Lab 1F"
    name, place = mapsecs.get(h["mapsec"], ""), title(const, "MAP_").split()
    nw = name.split()
    while place and nw and place[0] == nw[0]: place.pop(0); nw.pop(0)
    entry = {"name": name}
    if place: entry["place"] = " ".join(place)
    if h["enc"] != "ENCDATA_NA" and h["enc"] in enc_index:
        e = enc_list[enc_index[h["enc"]]]
        entry["hg"], entry["ss"] = table(e, "HEARTGOLD"), table(e, "SOULSILVER")
    ev = re.match(r"NARC_zone_event_(\w+)_bin", h["events"])
    path = root / "files/fielddata/eventdata/zone_event" / (ev.group(1) + ".json") if ev else None
    if path and path.exists() and not h["events"].endswith("DUMMY_bin"):
        z = json.loads(path.read_text())
        # Positions are global tile coordinates in the map's matrix: [x, z, ...]
        balls = [[o["x"], o["z"], n] for o in z.get("objects", []) if (n := item_name(o["scriptId"], "std_itemball_"))]
        hidden = [[b["x"], b["z"], n] for b in z.get("bgs", []) if (n := item_name(b["scriptId"], "std_hiddenitem_"))]
        trainers = [[o["x"], o["z"], *t] for o in z.get("objects", []) if (t := trainer(o["scriptId"]))]
        warps = []
        for wp in z.get("warps", []):
            dest = maps.get(wp["header"])
            if dest and not any(abs(w[0] - wp["x"]) + abs(w[1] - wp["z"]) <= 1 and w[2] == dest[0] for w in warps):
                warps.append([wp["x"], wp["z"], dest[0]])
        if balls: entry["items"] = balls
        if hidden: entry["hidden"] = hidden
        if trainers: entry["trainers"] = trainers
        if warps: entry["warps"] = warps

    # Blocks that make up the map: [bx, bz, landDataId]; exits to neighbouring overworld maps.
    if h["matrix"] not in matrices: matrices[h["matrix"]] = matrix(h["matrix"])
    w, hh, hdr, models = matrices[h["matrix"]]
    mine = [i for i in range(w * hh) if hdr is None or hdr[i] == num]
    if 0 < len(mine) <= 64:
        entry["blocks"] = [[i % w, i // w, models[i]] for i in mine]
        if hdr is not None:
            exits = {}
            for i in mine:
                for (dx, dz), d in DIRS.items():
                    x, zz = i % w + dx, i // w + dz
                    if 0 <= x < w and 0 <= zz < hh and hdr[zz * w + x] not in (num, 0):
                        exits.setdefault(hdr[zz * w + x], d)
            if exits: entry["exits"] = [[d, m] for m, d in exits.items()]
            # Blocks next to the map that its events spill into (shown dimmed on the mini map).
            spill = {(x >> 5, zz >> 5) for x, zz, *_ in entry.get("items", []) + entry.get("hidden", []) + entry.get("trainers", [])}
            extra = [[bx, bz, models[bz * w + bx]] for bx, bz in sorted(spill)
                     if 0 <= bx < w and 0 <= bz < hh and hdr[bz * w + bx] != num]
            if extra: entry["near"] = extra
    out[num] = entry

# Terrain colour class per tile behaviour (low byte of each terrain attribute):
# 1 grass, 2 water, 3 ledge, 4 door/warp, 5 sand/ice.
behaviors = {m.group(1): i for i, m in enumerate(re.finditer(r"^\s+(TILE_BEHAVIOR_\w+),", read("include/constants/metatile_behavior.h"), re.M))}
flags = dict(re.findall(r"\[(TILE_BEHAVIOR_\w+)\] = (TILE_BEHAVIOR_FLAG_\w+)", read("src/metatile_behavior.c")))
tiles = {}
for name, i in behaviors.items():
    f = flags.get(name, "")
    if "SURFABLE" in f or name in ("TILE_BEHAVIOR_WATERFALL", "TILE_BEHAVIOR_SHALLOW_WATER"): tiles[i] = 2
    elif "ENCOUNTER" in f and "CAVE" not in name: tiles[i] = 1
    elif name.startswith("TILE_BEHAVIOR_JUMP_"): tiles[i] = 3
    elif name == "TILE_BEHAVIOR_DOOR" or name.startswith("TILE_BEHAVIOR_WARP"): tiles[i] = 4
    elif name in ("TILE_BEHAVIOR_SAND", "TILE_BEHAVIOR_ICE"): tiles[i] = 5

json.dump({"source": "pret/pokeheartgold", "tiles": tiles, "maps": out}, sys.stdout, ensure_ascii=False, separators=(",", ":"))
