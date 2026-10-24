# Exp. Share (HeartGold / SoulSilver)

Code: `js/expshare.js` (`ExpShare`), loaded after `js/guide.js`. Test: `node tools/test_expshare.js` (fake RAM, dummy bytes).

- Always-on, whole party, full EXP (Kenny's choice, 2026-10-24): after each knockout every party Pokémon gets the same
  EXP as the one that fought. Eggs and fainted Pokémon get nothing, Lv 100 is skipped as usual. EVs go to everyone.
  Lucky Egg, traded and trainer-battle boosts still apply. Only the Pokémon on the field gets "gained X Exp. Points!";
  benched ones get no message unless they level up ("grew to Lv. N!", stat summary, move learning, evolution after battle
  all work normally). A combined "your team gained EXP" line isn't possible without new game text.
- The **Exp. Share: On/Off** button in the top bar toggles it (localStorage `pp_expshare`, default on). Its tooltip
  says "working in this battle" once the patch has gone in. Only shown for game codes IPK/IPG.
- How: nothing in the ROM or save changes. Every 0.5s the page checks DS RAM (wasm heap, base found via the ROM
  header copy at RAM + 0x3FFE00, same as the guide) for the battle overlay (overlay 12). When it is loaded with its
  original bytes, a few Thumb instructions are rewritten, like an Action Replay code. The overlay is reloaded for every
  battle, so it is re-patched each time. All four sites must match byte for byte before anything is written; turning
  it off mid-battle writes the saved original bytes back.
- The patch (addresses for the US ROM, from pret/pokeheartgold's pre-decompilation `asm/overlay_12_battle_command.s`,
  commit 9d46feb8; the decomp is matching, so these are the real ROM bytes; HG and SS share them):
  - `BtlCmd_CalcExpGain` (0x0223E6A0): nop the `beq` at 0x0223E79E so the "someone holds an Exp. Share" branch is always
    taken, `lsr r4, r0, #1` -> `adds r4, r0, #0` at 0x0223E7A0 (full EXP, not half), and nop the two `blx _s32_div_f` at
    0x0223E7A6 / 0x0223E7C6 so nothing is split. Result: `gainedExp` (ctx+0x9C) = `partyGainedExp` (ctx+0xA0) = EXP.
  - The other branch of that `beq` (0x0223E7E2-0x0223E805) is dead after this, and holds an 18-halfword routine (code cave)
    used by the message step below. It returns Z=0 for "print the message" when the slot is
    `ctx->selectedMonIndex[expBattler]` (ctx+0x219C), else Z=1 with r0 = next state: 0x25 (check done) if the Pokémon got
    no EXP, or 3 (EXP gauge state, which sends a Pokémon not on the field straight to the level-up check).
  - `Task_GetExp` (0x02245898), slot picker loop: `mov r1, #6` (held item) -> `#76` (MON_DATA_IS_EGG) at 0x022458DC,
    nop the `bl GetItemAttr` at 0x022458EE, `cmp r0, #0x33` -> `cmp r0, #0` at 0x022458F2: every non-egg slot gets a turn.
  - `Task_GetExp`, EXP sum: `beq` -> `b` at 0x02245A4A (fighters don't add `gainedExp`) and `cmp r0, #0x33` -> `cmp r0, r0`
    at 0x02245A56 ("holds an Exp. Share" always true): everyone gets `partyGainedExp` = EXP.
  - `Task_GetExp`, message: `ldr r0, [sp, #0x38]; cmp r0, #0` at 0x02245B3E -> `bl 0x0223E7E2`; the `beq` after it goes to
    0x02245B76, whose `mov r0, #0x25` is nopped so it stores the routine's r0 as the state.
  - The routine and the message hook were checked in unicorn (Thumb emulator) for: fainted, on field, benched, doubles.
- Other versions/regions: if the first site isn't at the US address, 0x02200000-0x02280000 is searched for its bytes and
  the other sites are taken at the same offsets. If nothing matches, nothing is written (the tooltip keeps saying
  "Waiting for the first battle").
- The calls to `_s32_div_f` are `blx` (ARM target, second half 0xE8xx), not `bl` (0xF8xx): the first version only
  accepted `bl`, so it never matched and never patched (Kenny, SoulSilver USA, 2026-10-24). Fixed in `isBl()`.
- HG and SS overlay 12 differ only by one immediate (`cmp r0, #GAME_VERSION` in overlay_12_022378C0.s), same size.
- Tested only against fake RAM here (no ROM in the repo). If it misbehaves, ask Kenny for the button's tooltip text.
