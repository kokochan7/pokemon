# More Master Balls (HeartGold / SoulSilver)

Code: `js/masterball.js` (`MasterBalls`), loaded after `js/expshare.js`. Test: `node tools/test_masterball.js`
(fake RAM, dummy bytes). Kenny's picks, 2026-11-01. Always on, no setting. Only for game codes IPK/IPG.
Nothing in the ROM or save file changes: the bag and a little shop code are edited in DS RAM, and the game
saves the bag normally the next time you save.

## Rewards (one Master Ball each)

| What | Rule |
| --- | --- |
| Shiny wild Pokémon | `(OT id low ^ OT id high ^ PID low ^ PID high) < 8`. A wild Pokémon gets the player's OT id (pret `encounter_check.c`). |
| "Perfect" wild Pokémon | IV total 150+ of 186 (about 1 in 170). Six 31s don't count: that's what Kenny's IV cheat gives every wild Pokémon. |
| Lucky find | 1 in 200 wild Pokémon, decided by a hash of the PID, so reloading can't re-roll it. |
| Bug-Catching Contest 1st place | On top of the prize stone. |

- Wild rewards come from the guide's wild IV reader (`wildTick` in `js/guide.js` calls `MasterBalls.wild`), so
  they only work while the guide panel is shown (as for the IV box). Not on the guide's first look, which can
  still see Pokémon from battles before the page loaded. The PIDs already paid are kept in localStorage
  (`masterBallPids`, last 300), so a reloaded save state doesn't pay twice.
- A purple notice at the top of the page says "Master Ball! (reason)", or that the Balls pocket is full.
- The bag (pret `bag_types_def.h`) is at general block +0x644, 0x79C bytes; the Balls pocket is at +0xD04,
  24 slots of `{ u16 item, u16 count }`. Master Ball = item 1, max 999. An existing Master Ball slot goes up by
  one, else the first empty slot gets it.
- In a battle the game works on a copy of the bag (`BattleSetup.bag`) and copies it back over the save's bag
  when the battle ends (`sub_0205239C` in `battle_setup.c`). So the reward is written to the save's bag and to
  every exact copy of it in the same DS RAM image (found by comparing all 0x79C bytes). A freed copy from an
  older battle may get it too; that's harmless.
- The save data the guide follows (`Guide.save()`, the live general block) is the one written; the RAM image
  comes from `ExpShare.bases()`.

### Bug-Catching Contest

The judge's script (`scr_seq_0151.s`) sets `FLAG_WON_THIS_BUG_CONTEST` (0x141) for 1st place, then gives the
prize (`overlay_bug_contest.c`): a Sun Stone, or with the National Dex one of Sun/Moon/Fire/Thunder/Water/Leaf/
Shiny/Dusk/Dawn/Oval Stone. Every 0.5s, while the map is National Park (96) or the contest park (487), the
stones in the Items pocket are counted. If the count goes up while the flag is set, that's the prize. The flag
stays set after a win, so the park's Shiny Stone item ball (flag 1286) is left out. If the bag is full and the
prize is held at the gate, there's no Master Ball.

## Goldenrod Dept. Store 2F: Master Ball for ₽10,000

- The ball clerk (map T25R1002 = map 192, `SpecialMartBuy 4`) sells from `_020FBC1A` in ARM9 data (pret
  `scrcmd_mart.c`): Poké, Great, Ultra Ball, Escape Rope, Poké Doll, Repel, Super Repel, Max Repel, Grass,
  Flame, Bubble, Space Mail. The Master Ball goes after the Ultra Ball; the list can't grow, so Space Mail is
  dropped. Celadon 2F's identical list (T07R0102, `SpecialMartBuy 19`, `_020FBC4E`, 0x34 after) is left alone.
  Found by searching 0x020F0000-0x02108000 for exactly two copies 0x34 apart; re-patched if the original comes
  back (a reset). The first version (PR #89) patched the second copy, which is Celadon's (T07 is Celadon, T25 is
  Goldenrod); Kenny's RAM dump with the shop open showed the shop's heap copy of the first list (2026-11-01).
  A Celadon list still patched that way is put back.
  Console: "Master Balls: Goldenrod 2F list patched at 0x...".
- The price: `ShopMenu_GetItemPrice` (overlay 3, 0x02258120 US; `ov03_02258120` in
  `asm/overlay_03.s` at commit 8ec18b15c^) returns `GetItemAttr(item, ITEMATTR_PRICE)` for a normal mart, and
  the Master Ball's price there is 0. The 0x40-byte function is rewritten in place: a normal mart returns 10000
  for item 1 (`cmp r1, #1; beq` -> `movs r0, #0x27; lsls r0, #8; adds r0, #0x10`). To make room, the seal and
  Pokéathlon/data card paths are shortened (`subs r0, #3; cmp r0, #1; bhi` instead of `adds r0, #0xfd; lsl; lsr;
  cmp; bhi`, and the two "return 100" paths share one). The `bl GetItemAttr` moves 4 bytes, so it's re-aimed
  (`moveBl`); the other bl stays put. Assembled with keystone and run in unicorn against the original for mart
  types 0-5 and several items: only type 0 + Master Ball changes (0 -> 10000).
  Console: "Master Balls: shop price 10000 patched". US address only (no search), checked byte for byte first.
- Selling a Master Ball still isn't possible: the bag's sell price reads the item data (0) directly.
- Tested only against fake RAM here (no ROM in the repo). If the shop doesn't show it, ask Kenny for the
  console lines and a "Save debug data" RAM dump.
