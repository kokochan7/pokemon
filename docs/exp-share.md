# Exp. Share and +5 trainer levels (HeartGold / SoulSilver)

Code: `js/expshare.js` (`ExpShare`), loaded after `js/guide.js`. Test: `node tools/test_expshare.js` (fake RAM, dummy bytes).

- Always-on, whole party (Kenny's choice): after each knockout the Pokémon that fought get 200% of the EXP (EXP +
  EXP) and every other party Pokémon gets 100% (EXP). History, all Kenny's calls: 100% for everyone
  (2026-10-24), then benched 75%, then 50%, then fighters 75% with +5 trainer levels, then fighters 100% (2026-10-25), then fighters 200% and benched 100% (2026-10-31). Eggs and fainted Pokémon get nothing, Lv 100 is skipped as usual. EVs go to everyone.
  Lucky Egg, traded and trainer-battle boosts still apply. Only the Pokémon on the field gets "gained X Exp. Points!";
  benched ones get no message unless they level up ("grew to Lv. N!", stat summary, move learning, evolution after battle
  all work normally). A combined "your team gained EXP" line isn't possible without new game text.
- Always on, no button or setting (Kenny asked for it to be permanent, 2026-10-24; the first version had an On/Off
  button). Only for game codes IPK/IPG. The console logs "Exp. Share: battle code patched" the first time it patches.
- How: nothing in the ROM or save changes. Every 0.5s the page checks DS RAM (wasm heap, base found via the ROM
  header copy at RAM + 0x3FFE00, same as the guide) for the battle overlay (overlay 12). When it is loaded with its
  original bytes, a few Thumb instructions are rewritten, like an Action Replay code. The overlay is reloaded for every
  battle, so it is re-patched each time. All four sites must match byte for byte before anything is written.
- The patch (addresses for the US ROM, from pret/pokeheartgold's pre-decompilation `asm/overlay_12_battle_command.s`,
  commit 9d46feb8; the decomp is matching, so these are the real ROM bytes; HG and SS share them):
  - `BtlCmd_CalcExpGain` (0x0223E6A0): nop the `beq` at 0x0223E79E so the "someone holds an Exp. Share" branch is always
    taken, replace `lsr r4, r0, #1; ldr r1, [sp, #4]; add r0, r4, #0` at 0x0223E7A0 with
    `adds r4, r0, #0; nop; nop`, and nop the two `blx _s32_div_f` at 0x0223E7A6 / 0x0223E7C6 so
    nothing is divided by the number of fighters. Result: `gainedExp` (ctx+0x9C) = EXP, `partyGainedExp` (ctx+0xA0) =
    EXP (each at least 1). Checked in unicorn: EXP 100 -> 100 + 100, 63 -> 63 + 63. (Earlier splits used
    `lsrs r1, r0, #1; subs r4, r0, r1` then `adds r0, r1, #0` for EXP/2 + EXP - EXP/2, or `lsrs r0, r1, #1` for EXP/4.)
  - The other branch of that `beq` (0x0223E7E2-0x0223E805) is dead after this, and holds an 18-halfword routine (code cave)
    used by the message step below. It returns Z=0 for "print the message" when the slot is
    `ctx->selectedMonIndex[expBattler]` (ctx+0x219C), else Z=1 with r0 = next state: 0x25 (check done) if the Pokémon got
    no EXP, or 3 (EXP gauge state, which sends a Pokémon not on the field straight to the level-up check).
  - `Task_GetExp` (0x02245898), slot picker loop: `mov r1, #6` (held item) -> `#76` (MON_DATA_IS_EGG) at 0x022458DC,
    nop the `bl GetItemAttr` at 0x022458EE, `cmp r0, #0x33` -> `cmp r0, #0` at 0x022458F2: every non-egg slot gets a turn.
  - `Task_GetExp`, EXP sum: `cmp r0, #0x33` -> `cmp r0, r0` at 0x02245A56 ("holds an Exp. Share" always true): fighters
    get `gainedExp + partyGainedExp` = 200%, everyone else `partyGainedExp` = 100%. (For 100% for everyone, the `beq` at
    0x02245A4A became `b` so fighters skipped `gainedExp`, and `partyGainedExp` was the full EXP.)
  - `Task_GetExp`, message: `ldr r0, [sp, #0x38]; cmp r0, #0` at 0x02245B3E -> `bl 0x0223E7E2`; the `beq` after it goes to
    0x02245B76, whose `mov r0, #0x25` is nopped so it stores the routine's r0 as the state.
  - The routine and the message hook were checked in unicorn (Thumb emulator) for: fainted, on field, benched, doubles.
- Other versions/regions: if the first site isn't at the US address, 0x02200000-0x02280000 is searched for its bytes and
  the other sites are taken at the same offsets. Once it has patched, the address and RAM area are kept, and it stops
  searching. If nothing matches, nothing is written (and nothing is logged).
- The calls to `_s32_div_f` are `blx` (ARM target, second half 0xE8xx), not `bl` (0xF8xx): the first version only
  accepted `bl`, so it never matched and never patched (Kenny, SoulSilver USA, 2026-10-24). Fixed in `isBl()`.
- HG and SS overlay 12 differ only by one immediate (`cmp r0, #GAME_VERSION` in overlay_12_022378C0.s), same size.
- Tested only against fake RAM here (no ROM in the repo). If it misbehaves, ask Kenny whether the console shows "Exp. Share: battle code patched".

## +5 trainer levels

- Every NPC trainer's Pokémon is 5 levels higher (`LEVEL_UP` in `js/expshare.js`; Kenny's choice 2026-10-25, because the
  Exp. Share left his team ~15 levels ahead). Wild Pokémon are unchanged. Same code in the same file, same DS RAM base.
- `CreateNPCTrainerParty` (ARM9 static code, 0x02073604 in HG US; from pre-decompilation `asm/trainer_data.s`, commit
  aeba178b^) calls `CreateMon(mon, species, level, iv, ...)` once per trainer data layout (4 calls, at 0x02073702,
  0x020737EC, 0x020738F6, 0x020739F6 in HG US). Each is preceded by the same 14 halfwords apart from two
  `ldr rX, [sp, #n]` stack offsets. `iv` is at most 31, so its `lsl r3, r3, #0x18 ... lsr r3, r3, #0x18` truncation is a
  no-op: the lsl becomes a nop and the lsr becomes `adds r2, #5` (r2 = level). The personality seed reads the level
  separately, so the Pokémon's nature/gender/ability stay what they'd normally be.
- The ARM9 range 0x02000000-0x02110000 is searched every 5s until exactly 4 matches lie within 0x400 bytes (any other
  count: nothing is written). Then those 4 spots are checked every 0.5s and re-patched if the original bytes come back
  (a reset or a save state). Console: "Trainer levels +5: patched at 0x...". Checked in unicorn (level 30 -> 35, iv kept).
- The guide panel's trainer teams (`js/guide.js`) and NEXT boss teams (`js/story.js`) show the level from the data plus
  `ExpShare.LEVEL_UP`, so they match what the game creates. `guide/hgss.json` and `guide/bosses.json` keep the original levels.

## 2x HP bar speed

- Battle HP bars (yours and the enemy's) drain and fill twice as fast (Kenny, 2026-10-29: "enemy HP drops too slow").
  Same file, same overlay 12 check every 0.5s, always on. Damage and HP are unchanged; only the animation is faster.
- `ov12_022657E4` (0x022657E4, US; pre-decompilation `asm/overlay_12_hp_bar.s`, commit 090b1267^, now
  `src/battle/battle_hp_bar.c`) calls `BattleHpBar_CalculatePixelsChangeFrame(..., tilesWide = 6, hpChange = 1)` for HP.
  For max HP 48 and up the bar moves `hpChange` HP per frame, clamped to the new HP. `movs r0, #1` at 0x022657F2
  becomes `movs r0, #2`. The 14 halfwords from 0x022657E4 must match first (encoding checked with capstone).
- Below 48 max HP the bar moves one pixel per frame instead (at most 48 frames for a full bar) and is unchanged:
  that path is shared with the EXP bar.
- Patched on its own (`HP_BAR` in `js/expshare.js`), so a mismatch there never stops the Exp. Share, and vice versa.
  Console: "HP bars 2x: battle code patched". If the overlay sits elsewhere, it uses the Exp. Share's search shift.
