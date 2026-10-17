# Tooltips

The remake's tooltips are the original's (`src/ui/tooltip.js`): the same texts, the same lines in the same order, in
the same window.

## Where the texts come from

* Every object and action tooltip is a **help item** of the encyclopedia, `Texts/Help/*.seml`:
  `\{helpitem -name <key> <Title>}` with `tooltipshort` (the `%/class:chtr/vschtr:+...%` attributes),
  `tooltipmedium` (the bullet lines) and `tooltiplong` (the encyclopedia's text, not in the tooltip).
  `pwexport/texts.py parse_help` reads them (shared with the Model Exporter); `pipeline/build_data.py` writes them to
  `gamedata.json` "texts" (name, cls, vs, lvl, medium, long).
* The **key** is the tech tree's `description` of the action's location (`Actions/.../locations/<i>/description`,
  `CmdButton.usl:146`) or of the object (`HelpMenu.GetObjHelpitemKey`): `_hu_drums`, `_stance_0`, `_cole`. The
  command bar's own buttons use fixed keys (`cb_walk`, `cb_attack`, `cb_level_up` ..., `CommandBar.usl:824-1068`),
  the minimap's `mm_*`, the info window's `_iw_*`, the top bar's `_tb_*` - all in `H_ui.SEML`.
* A key without a help item shows as it is, under an empty title (`CmdButton.usl:154`).
* The sequel's own classes (generating station, searchlight tower, trooper ...: `game/sequel/rules.js`) are copies
  of an original (most buildings of the SEAS gun tower) and keep its build action, so also its location's description
  key; their tooltips and info window show their own texts (`game/sequel/texts.js`; `Rules.actionText`, `text`).
  Test `tests/sequel_texts.js`.
* The language pack's folders as `Data/Info/Locale_UK.info` lists them, a later folder's **file** replacing the same
  file of an earlier one (not merged per key): `locale/uk`, `BoosterPack3/Locale/uk` (always), `MIRAGE/Locale/uk`
  (with MIRAGE). `pwexport/install.py locale_dirs / locale_files`.
* The command bar's lines come from the string table (`main_uk.ltf`, `gamedata.json` "ui"):
  `_ObjCommandBar_InventionsNeeded` "• Inventions required:", `_ObjCommandBar_BuildingsNeeded`,
  `_ObjCommandBar_RequiresLevel`, `_ObjCommandBar_UnitLevelReached`, `_ObjCommandBar_AlreadyInventing`,
  `_ObjCommandBar_NoLevelUp`, `_UI_CommandBar_Level`.

## The lines (`ToolTipWindow.usl GenerateMsgScript`)

1. The title row on `tt_bgimage_title`: the class icon (`tt_class_chtr | anml | vhcl | bldg`, "other" for upgrades,
   moves and buttons) and the title.
2. The heroes' level rows, level 5 down to 1, with the level icons.
3. The help text (`tooltipmedium`); instead of it "Unit/Level maximum reached" when the army pyramid has no place.
4. The requirement lines: the missing inventions (their ids: the original doesn't translate them), the missing
   buildings (their names), the level a special move needs; "Already inventing at another site" instead of these and
   the costs while the player's invention runs elsewhere.
5. The strengths against infantry, animals, vehicles and buildings (`tt_bgimage_value` with `tt_quality_*`).
6. The costs: skulls, food, wood, stone - all four, 0 too - on `tt_bgimage_stats`, light red what the player can't
   afford. (The sequel's electricity below them.)

No durations, cooldowns or keys: the original shows none (the digits are on the armed row's buttons).

## Where

One window for every tooltip, 235 px wide, above the minimap in the bottom right corner, growing upwards, pale yellow
text on the 9-slice frame `hud/tooltip_*.tga`; without a tooltip the closed tab `tooltip_closed.tga`
(`IngameScreen.usl:265-268`, `ToolTipWindow.usl`). A single text (a question mark's) takes its first line as the
title.

| What | Key |
|---|---|
| build / produce / upgrade / hire / special move | the action location's description |
| menu buttons | `cb_build`, `cb_produce`, `cb_specials`, `cb_set_stance`, `cb_unload` |
| action buttons | `cb_walk`, `cb_attack`, `cb_agressive_walk`, `cb_stop`, `cb_repair`, `cb_dismount_all`, `cb_set_rallypoint`, `cb_level_up` (+ "No Level-Up possible", the skulls), `cb_kill` |
| stances | `_stance_0` .. `_stance_2` |
| passengers | the passenger's name and "Level: N" |
| portrait, pyramid cards | the object's help item |
| info window | `_iw_hitpoints`, `_iw_attack(_pierce)(_poison)(_area)`, `_iw_rangeattack...`, `_iw_range`, `_iw_defense_melee`, `_iw_defense_arrow`, `_iw_skulls`, `_iw_resourceamount` |
| resource bar, menu button, quest button | `_tb_unitlimit`, `_tb_skulls`, `_tb_food`, `_tb_wood`, `_tb_stone`, `_tb_menu`, `_tb_quests` |
| minimap buttons | `mm_show_landscape`, `mm_show_resources`, `mm_show_mapping`, `mm_zoom_in`, `mm_zoom_out` |
