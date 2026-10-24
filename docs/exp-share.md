# Exp. Share (HeartGold / SoulSilver)

Code: `js/expshare.js` (`ExpShare`), loaded after `js/guide.js`. Test: `node tools/test_expshare.js` (fake RAM, dummy bytes).

- Always-on, Gen 6+ style: after each knockout the Pokémon that fought get the full EXP and every other party
  Pokémon gets half. Eggs and fainted Pokémon get nothing, Lv 100 is skipped as usual. EVs go to everyone, like
  Gen 6+. Lucky Egg, traded and trainer-battle boosts still apply. Each benched Pokémon gets its own
  "gained X Exp. Points!" line (the game's own Exp. Share message flow), and level-ups / evolutions work normally.
- The **Exp. Share: On/Off** button in the top bar toggles it (localStorage `pp_expshare`, default on). Its tooltip
  says "working in this battle" once the patch has gone in. Only shown for game codes IPK/IPG.
- How: nothing in the ROM or save changes. Every 0.5s the page checks DS RAM (wasm heap, base found via the ROM
  header copy at RAM + 0x3FFE00, same as the guide) for the battle overlay (overlay 12). When it is loaded with its
  original bytes, a few Thumb instructions are rewritten, like an Action Replay code. The overlay is reloaded for every
  battle, so it is re-patched each time. All four sites must match byte for byte before anything is written; turning
  it off mid-battle writes the saved original bytes back.
- The patch (addresses for the US ROM, from pret/pokeheartgold's pre-decompilation `asm/overlay_12_battle_command.s`,
  commit 9d46feb8; the decomp is matching, so these are the real ROM bytes):
  - `BtlCmd_CalcExpGain` (0x0223E6A0): nop the `beq` at 0x0223E79E so the "someone holds an Exp. Share" branch is always
    taken, and nop the two `bl _s32_div_f` at 0x0223E7A6 / 0x0223E7C6 so neither half is split. Result:
    `gainedExp` (ctx+0x9C) = `partyGainedExp` (ctx+0xA0) = EXP / 2.
  - `Task_GetExp` (0x02245898), slot picker loop: `mov r1, #6` (held item) -> `#76` (MON_DATA_IS_EGG) at 0x022458DC,
    nop the `bl GetItemAttr` at 0x022458EE, `cmp r0, #0x33` -> `cmp r0, #0` at 0x022458F2: every non-egg slot gets a turn.
  - `Task_GetExp`, EXP sum: `cmp r0, #0x33` -> `cmp r0, r0` at 0x02245A56, so "holds an Exp. Share" is always true:
    fighters get EXP/2 + EXP/2, the rest EXP/2.
- Other versions/regions: if the first site isn't at the US address, 0x02200000-0x02280000 is searched for its bytes and
  the other sites are taken at the same offsets. If nothing matches, nothing is written (the tooltip keeps saying
  "Waiting for the first battle").
- The calls to `_s32_div_f` are `blx` (ARM target, second half 0xE8xx), not `bl` (0xF8xx): the first version only
  accepted `bl`, so it never matched and never patched (Kenny, SoulSilver USA, 2026-10-24). Fixed in `isBl()`.
- HG and SS overlay 12 differ only by one immediate (`cmp r0, #GAME_VERSION` in overlay_12_022378C0.s), same size.
- Tested only against fake RAM here (no ROM in the repo). If it misbehaves, ask Kenny for the button's tooltip text.
