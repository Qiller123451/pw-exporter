# Point buy ("My Army") — the original's rules and the remake's port

Sources (all `Data/Base/Scripts/`, no script overrides in BoosterPack1/3, MIRAGE, Wintermod):
PD = `Game/UI/PointBuy/PyramidDialog.usl`, PBM = `…/PointBuyMenu.usl` (+ `CPointBuyMgr`), SHL = `…/ShoppingList.usl`
(+ `CPointBuyList`), PW = `…/PresetWindow.usl` (+ `CPointGauge`), NP = `Game/UI/NewPyramid.usl`, PC =
`Game/UI/PyramidCard.usl`, PRM = `Game/mgr/PyramidRestrictionsMgr.usl`, GIW = `Game/UI/GameInfoWindow.usl`, CM =
`Game/UI/CampaignMenu.usl`, CMG = `Game/mgr/CampaignMgr.usl`, PIS = `Game/UI/PlayerInfoSlot.usl`, NMP =
`Game/UI/NewMultiPlayerPreGameWindow.usl`, LSP = `Game/UI/LevelSettingsPage.usl`, SL =
`Server/classes/misc/StartLocation.usl`, AF = `Server/misc/ActionFactory.usl`, AIC = `Ai/Modules/AiModuleControlDefault.usl`.
Data: NPC = `Server/settings/NewPointBuyCosts.txt`, DP = `Game/misc/DefPresets.txt`, CT = `Server/settings/Campaigns.txt`,
AD = `Data/Base/UI/All_def.txt`. Complements ui_groups7_9.md §7 (not repeated there: budget list, placement).
Indices in the scripts are 0-based (level 0 = pyramid row "L1").

## 1. The pyramid

### 1.1 Slots and levels
52 slots (`TotalSlotCount`, engine `CTribeViewLayoutMgr`). Level of a slot (PBM:234-245, SL:492-503, identical):

| level | slots | count | visual rows × cols (HUD art `hud/pyramid_open.tga`, same as remake `hud.js` PYR) | card size (AD card_fixed) |
|---|---|---|---|---|
| L1 (0) | 0-24 | 25 | 5 × 5 (bottom block) | 31×30 |
| L2 (1) | 25-39 | 15 | 3 × 5 | 31×30 |
| L3 (2) | 40-47 | 8 | 2 × 4 | 37×36 |
| L4 (3) | 48-50 | 3 | 1 × 3 | 51×49 |
| L5 (4) | 51 | 1 | 1 × 1 (top) | 64×61 |

Order of slot ids inside a level (which cell is slot 0) and `FindFreeSlot(level)` (which free slot is taken) are
engine-side [?engine]; the scripts imply "first free, non-blocked slot of the level" and that blocking takes the
**highest** ids of a level first (NP:1950-1970), so slot 24 = last L1 cell. In point-buy mode the pyramid is the HUD
pyramid (`CNewPyramid`, 181×548, `SmallView`, NP:1404-1436) at (41,0) of the dialog (PD:34-41).

### 1.2 Fill rules
* **No support/adjacency rule** in the scripts (a level-n card needs nothing below it); the only limit is the
  per-level capacity = slot count, reduced by
  `Restrictions/Chars/Level<n>/Max` of `PlayerSettings/Player_<ClientID>` (PRM:128-143) and by 1 on L1 for Aje
  (`SetAjeBlockedSlot`, PRM:111-114, 164-166). `UpdateBlockedSlots` (NP:1972-1998) marks the excess slots
  `m_bBlocked` (highest ids first), re-run on every dialog update (`PD.OnUpdateContent` → `NP.Init` → NP:2010).
  `MaxStart` is passed nowhere (both BlockSlots arguments = Max, NP:1977) [unused].
  [bug] PRM reads the *client's* current LevelInfo (`GetLevelInfo`, PRM:52) and `Player_<ClientID>`, not the
  previewed mission / own slot, so in the menus the level limits probably do not apply [?engine]. [bug] The Aje
  reduction depends on `CNewPyramid.ms_sPBTribe`, set only by the MP player row (PIS:198-202) and read only when
  `SetPointBuyMode(true)` runs once in `PD.Init` (NP:170-172) — effectively never active; the Aje collector card in
  slot 24 occupies the cell anyway.
* `LoadPreset` resets `m_bUsed/m_bBlocked/m_bBlockedPerm` of all slots (PD:149-159), then places cards with
  `CreateCardInSlot` **without any free/blocked check** (NP:384-417; a slot id ≥ 52 → an invisible "additional
  card" with slot −1 [edge]).
* Level-data `PointBuyPreset/BlockedSlots` (e.g. single_02: 51) is **never read** by the scripts [?engine]. A preset
  entry with class **`Blocked`** (single_10 slot 20) is the scripted way: card "Blocked", cost 0 (class unknown to
  NPC), not draggable (PD:175-180), fixed in single player, skipped by the server (SL:533-535).

### 1.3 Fixed cards (`m_iFixedLevel`)
* `LoadPreset(…, p_bSetFixed, …)`: p_bSetFixed = `GIW type == GIWT_SINGLEPLAYER` (PBM:86). Single player: **every
  preset card is fixed** at its slot's level (PD:167-170); multiplayer: no preset card is fixed.
* A fixed card: overlay layer `card_fixed` (PC:359-361), tooltip `_UI_AC_PointBuy_Card_Locked` ("Move unit to higher
  level only, points required. Units cannot be sold", NP:397-401); right-click does nothing (PC:678-683); cannot be
  dropped outside (PBM:149); may be dragged within the pyramid, but not to a level below its fixed level (NP:1884).
  Normal card tooltip `_UI_AC_PointBuy_Card` ("Move unit to another level, points required. Right click: Sell").
* **Aje resource collector**: if tribe Aje and `IncludeBuildings` (PlayerSettings/Player_n/IncludeBuildings, default
  1), `aje_resource_collector` is put in **slot 24**, fixed at level 0 (also in MP) and not draggable — after the
  preset units in LoadPreset (PD:185-195) and again after Clear (PD:343-371). Its price (L1 = 250) is charged like
  any card (CalcCardCosts) and credited back as a gift (GIW:410-415, §3.4). [bug] If a preset already holds slot 24
  (e.g. a user preset saved from an Aje army, §5.3), the collector card replaces it in the cell while the first card
  is charged in LoadPreset but lost [?engine on overwrite].

### 1.4 Buying a card
* **Arrow buttons** (PD:96-124, 292-311): 5 `CIDButton` id = level 0..4, x 220, y 431 / 281 / 177 / 99 / 25 (L1..L5),
  54×35, bitmaps `menue/controls/pointbuy_addarrow{,_down,_hover,_disabled}.tga`, price text (x 228, 46×35) =
  `m_aiCostAtLevel[level]` of the selected shop entry. Visible only if that price > 0; enabled iff price ≤ points
  left **and** `FindFreeSlot(level) != −1` **and** `CheckRestrictions` (hero once); text white if enabled, grey
  (128,128,128) otherwise. Click → `PBM.OnBuyUnit(selection, level)` (PD:413-419).
* `OnBuyUnit(info, level)` (PBM:110-122): slot = FindFreeSlot(level); none → nothing; cost =
  `GetCostForUnit(class, slot, tribe)`; `credits − cost < 0` → nothing; else `CreateCard(level, class)` (not fixed).
* **Double-click** a shop entry (SHL:84-88, PBM:95-108): the **lowest** level whose price ≠ −1, that passes
  CheckRestrictions and has a free slot; then as above (if unaffordable there, nothing — no higher level tried).
* Drag from the shop list: the drop code expects a `CShoppingTab.CShoppingInfo.ShoppingIcon` source (NP:1838-1859,
  1924-1929), a class that is never instantiated (the list is a plain `CList`) → **not possible** [dead code].
* **Hero once** (PBM:128-136): if the class is in the shop's `Heroes` category (SHL:395-401) and a card of that class
  exists anywhere (PD:319-329), it cannot be bought. [bug] Preset heroes are named `Stina_s0`, the shop entry is
  `special_eusmilus` (SHL:327-333), so Stina can be bought a second time next to a preset Stina.

### 1.5 Moving cards (drag & drop inside the pyramid; NP:1828-1941)
Accept (`AcceptDropWindowPB`): target slot must exist; same level → always; target level below fixed level → no;
**up**: `(pointsLeft + oldCost) − newCost ≥ 0`; **down**: allowed iff the new level has a price (`newCost != 0`).
Drop (`DropWindowPB`): `SwapSlotsAndCardsFast(new, old)` (NP:568-600) — swaps with whatever is in the target slot,
no further checks. [bug] the swapped-out card's cost change is not checked (points can go negative), a fixed card can
be pushed below its fixed level by dropping another card onto it, and blocked target slots are not refused
[?engine whether SlotHitTest returns blocked slots]. Points are recomputed after every change (§3.5).

### 1.6 Selling, Default, Clear
* **Sell** = right-click a non-fixed card (PC:675-683 → `KillCard`) or drag it out of the pyramid onto the menu
  (PBM:143-162; refused for fixed or disabled cards). Refund = full current price (points are recomputed from the
  remaining cards, PBM:168-176). [bug] MP "Blocked" cards are not fixed → right-click removes them.
* **Default** (single player only, PD:132-135, 332-335; `_UI_PBMenu_Button_Default`, tooltip
  `_UI_AC_PointBuy_Default_TT` "Restore default settings."): `LoadDefaults` = `LoadPreset` again with the stored
  preset/resource nodes (PBM:85-88).
* **Clear** (multiplayer only, PD:136-140, 337-379; `_PointBuyMenu_Clear`, tooltip `_UI_AC_PointBuy_Clear` "Clears
  Army controller. Points are regained."): removes **all** cards (also fixed ones, NP:1287-1307), sets resources to
  food 30 / wood 0 / stone 0 (`GIW_MP_GIFTED_*`, GIW:224-226), re-adds the Aje collector (IncludeBuildings read from
  `PlayerSettings/Player_<owner>` of the campaign or client LevelInfo, PD:343-371). Button at (120,587) 100×18.

### 1.7 CorrectLevelToMinLevel (server, SL:292-314, called SL:536)
`minLvl = techtree(Objects/<tribe>/…/<class>).captainlevel − 1`; if the slot's level < minLvl the unit is created at
minLvl. The cost check uses the object's real level afterwards (SL:579-588), so a card below its minimum (price 0 in
the client) costs the min-level price on the server [bug: can trip the MP cheater check]. Only presets can produce
this (e.g. AI `Aje/AiPBPresetG2` allosaurus in L2 slots 25-26).

## 2. Card cost (`CPointBuyMgr.GetCostForUnit(class, slot, tribe)`, PBM:231-284)
1. level = slot level (§1.1); key `Level<level+1>`.
2. `node = NPC Units/<tribe>`; if missing → `Units/Heroes` [bug: then it searches hero sub-nodes for the class, i.e.
   returns 0]. For each category child (`Character`, `Animals`, `Vehicles`, in file order) — if it has a child named
   class → return `GetValueI("Level<n>")` (**missing level → 0**).
3. else `Units/Heroes/<class>/Level<n>`; not found → **0**.
So: unknown classes, generic names (`worker`, `Nature`, `Technics`, `Resource`) and `Blocked` cost **0** in the
client; heroes cost the same for every tribe (600 / 1000 / 2000 / 4000 / 8000). SEAS has a full price block
(`Units/SEAS`, `Resources/SEAS`) but SEAS is excluded from every tribe list (PW:156, PIS:881, SHL:251 `%3`), so it is
only reachable through map data. Missing `Level1..k` = not buyable below level k+1 (the shop shows −1 = no arrow).
Price file: `CPointBuyList` loads `Data/Base/Scripts/Server/settings/NewPointBuyCosts.txt` (SHL:487); the server the
same path (SL:446). Mod resolution: `BoosterPack1.info` `tryfilereplace */data/base/* data/base/ data/BoosterPack1/`
→ with BP1 enabled its copy is used (extra rows: hu_undead_warrior 300/600/1200/3000 from L2, hu/aje/ninigi
_flamethrower 280/560/1120/2500 from L2, heroes livingstone_s0, schliemann_s0); the MIRAGE chain (Base → BP3 →
MIRAGE) has no copy → Base prices. Old `PointBuyCosts.txt` is loaded by SL:413-417 and never used [dead].

## 3. Resources

### 3.1 Prices and formulas (PBM:286-303, NPC `Resources/<tribe>`; all four tribes: food 1.0, wood 1.5, stone 2.0, iron 100)
* `GetCostForResource(res, amount, tribe) = ceil(rate × amount)` (0 if tribe/res/rate missing). It is always called
  with the **total** amount of a resource (PD:405-411), so rounding happens once per resource total
  (wood 1 → 2, 2 → 3, 3 → 5 points).
* `GetNumResourceUnitsForPoints(res, points, tribe) = floor(points / rate)` (0 if rate missing).
* Iron/skulls: no button; the result always sends `iron = 0` (PD:391). MIRAGE's AD defines `pointbuy_res6/7`
  (`menue/controls/pointbuy_resource_skull.tga`, the only point-buy texture in the uploads) but no script uses it.

### 3.2 Buttons (PD:55-94, 430-480)
6 `CIDButton`s at y 547 from x 17, widths from AD (35, 33, 33, 33, 33, 35): id 0 food −, 1 food +, 2 wood −, 3 wood +,
4 stone −, 5 stone + (`pointbuy_res<id>{,_down,_disable}`); amount labels (60×22) at x+4 of the − buttons.
Tooltips `_UI_AC_PointBuy_Resource_Buy_<id>` ("Sell food. Price: 1 point/unit. Left click: 1 unit. Shift + Left
Click: 10 units. Ctrl + Left Click: 100 units. Ctrl + Shift + Left Click: 1000 units." …). Auto-repeat while held,
double clicks ignored. Per click: base 1; **Shift ×10, Ctrl ×100, Shift+Ctrl ×1000**.
* **+** : `amount = min(step, max(0, floor(pointsLeft / rate)))`; never overspends (ceil of the new total − ceil of
  the old ≤ points left).
* **−** : `amount = min(step, current)`; if `current − amount ≤ min` → `amount = current − min`; applied as
  negative. The − button is disabled while `current ≤ min` (PD:313-315).

### 3.3 Minimums (`m_aiMinRessources`, PD:197-238)
* Single player: min = the amount loaded from the resource preset (level `Restrictions/Resources`, capped, §6) —
  cannot sell below the mission's start resources. A preset value **−1** disables both buttons of that resource and
  sets 0 (PD:209-214). So in missions 4, 5, 9, 11, 16 (all −1) the player gets **0 resources and cannot buy any**
  [?engine whether SetPointBuyResult/SL then gives defaults]. Tribe sub-nodes (`Resources/Hu`, honoured by SL:609-619)
  are ignored by the client [inconsistency].
* Multiplayer: min = food 30, wood 0, stone 0 regardless of the preset (PD:228-232).

### 3.4 Gifts (GIW:399-424, 449-467)
`total = credits + gift` when credits ≠ −1. gift = **30** if MP **and a resource preset node exists** (GIW:405-409)
+ **price of aje_resource_collector at slot 24 (250)** if Aje and IncludeBuildings. The point gauge shows
`"%1 of %2 points"` (`_PointBuyMenu_PointGauge`, PW:474-481) with %1 = points left, %2 = total − gift (so %1 can
exceed %2). [bug] With no army preset selected in MP the 30-point gift is missing while the server still demands
food ≥ 30 (§9). Single-player gifts from preset units/resources were removed (RT#16992, GIW:374-375, 389-393):
**preset units are paid from the budget**.

### 3.5 Points left (PBM:168-176)
`left = total − Σ GetCostForUnit(card, slot) − Σ GetCostForResource(food|wood|stone)`, recomputed on every change.

## 4. Shopping list (SHL)
* Three tabs (SHL:15-25): `_UI_ShopList_Tab_Infantry` / `_Cavalry` / `_Heroes` (tooltips `_UI_Tab_Infantry_TT`
  "Select from available infantry units.", `_UI_Tab_Cavalry_TT` "…animal units.", `_UI_Tab_Heroes_TT`). Tab 0 =
  NPC category `Character`, tab 1 = `Animals` + `Vehicles`, tab 2 = `Heroes` (SHL:403-421).
* Entries (CShoppingTab.Init, SHL:240-393), order = NPC file order: `Units/<tribe>/Character`, `/Animals`,
  `/Vehicles`, then `Units/Heroes`. Tribe "Random" → random Hu/Aje/Ninigi (`Random.GetInt()%3`, SEAS branch
  unreachable, SHL:249-261). An entry is kept only if the **global** tech tree has `/Objects/<tribe>/<CHTR|ANML|VHCL>/
  <class>` (heroes: `/Objects/Special/CHTR/<hero>`; `Stina…` → class `special_eusmilus`, `/Objects/Special/ANML/`).
  NPC's own `special_eusmilus` hero row looks under CHTR and is dropped.
* Map filter: if a Restrictions node is given (single player: `PlayerSettings/Player_<owner>/Restrictions`, GIW:379;
  multiplayer passes **null** = no filter, PW:217-224) only classes named under `Chars/Infantry/<tribe>`,
  `Chars/Cavalry/<tribe>`, `Chars/Heroes/<tribe>` stay (SHL:288-311, 349-353). [bug-ish] A Restrictions node without
  these lists hides everything; an empty `Heroes/<tribe>` (single_02) = no heroes.
* Per entry: `m_aiCostAtLevel[0..4]` from the `Level1..5` children (−1 = missing), name/description = the tech-tree
  `description` key (tooltip text, descriptions containing "tutorial" are not used for the info box). Row = text
  `GetToopTipText(desc)` + icon blend `"2, layer <class>, layer card_frame"` (hover `card_frame_hover`). First row is
  selected after a rebuild. Below the list (200 px) the long tooltip of the selected/hovered class (also when hovering
  or clicking a pyramid card, PC:802-804, 818-825; SHL:452-460).

## 5. Presets

### 5.1 Default presets (DP; Hu DP:3-314, Aje 315-617, Ninigi 618-942; no SEAS)
Per tribe: `_pb_locked` (Cost −1: 3 workers slots 0-2, food 200 / wood 150 / stone 100 / iron 0) and
`_pb_{boomer,rusher}_{1000,3000,10000}_<tribe>`, `_pb_standard_{1000,3000,10000,100000}_<tribe>` (`standard = 1`
marks the list default); all `base = 1`. Node = `Cost`, `Units { <slot> = class }`, `Resources {iron, food, wood,
stone}`. Names are text keys translated on load (PW:356-376: `_pb_boomer_1000_hu` → "Boomer", `_pb_locked` →
"Predefined"). Checked: every Boomer/Rusher/Standard 1000/3000/10000 preset costs **exactly Cost + 30** (the MP food
gift); `_pb_standard_100000_*` = 3 workers + 10000 of each resource = 45180 (rest unspent). Aje presets never use
slot 24; some contain extra paid `aje_resource_collector`s.

### 5.2 Selection (MP; PW:129-294, PIS:566-598)
User DB `<UserSettingsDir>/PointBuyPresets/Presets.txt`; if empty → DP (PW:60-63). The army drop list (own row) =
presets of the tribe whose `Cost == game credits` (PW:270-287); current = slot value `Army` else the `standard` one
(selecting writes `Army`, PW:329-344). Credits −1 → only "Predefined", army page disabled (GIW:422). Tribe
**Random**: list Boomer / Rusher / Standard (translated `_pb_*`); at **Ready** a tribe is drawn from the map's
`Restrictions/Base/Tribes` minus SEAS (PIS:874-895) and the DP preset of that translated name and cost is loaded and
sent. The army page is disabled while Ready or for Random (PIS:866, 964).
`UpdateImmidiatly(tribe)` (PW:129-236) reloads the pyramid only when tribe/credits/Army changed and Army is
non-empty: finds `<tribe>/<Army>` with `Cost == credits`, then `GIW.UpdatePointBuy(tribe, credits, null, Units,
Resources, IncludeBuildings of PlayerSettings/Player_<HQ index>)` (SL uses the owner index [inconsistency]).

### 5.3 Save / delete / restore (PW:379-461)
Name edit: spaces → `_`; Save disabled if empty or credits −1. Save: replaces the node with same name **and** Cost,
else appends; writes `Cost = credits`, `Units { slot = class }` for every card (incl. the Aje collector),
`Resources {food, wood, stone, iron 0}`; saves the whole DB (defaults included, with translated names). Delete
enabled only for `base == 0`; removes the first child of that **name** (any cost) [bug]. "Restore Defaults" reloads
DP and overwrites the file (own presets lost).

## 6. `LoadPreset(credits, tribe, preset, resPreset, setFixed, includeBuildings)` (PD:145-239)
1. Clear pyramid; reset all slot flags. `left = credits` (= total incl. gifts). If `preset == null` → **return**
   (resources/buttons keep their old values [bug]).
2. For each preset child **in file order** (empty names skipped): `slot = int(name)`, `class = value`,
   `fixed = setFixed ? level(slot) : −1`, `cost = GetCostForUnit`. If `cost ≤ left` **or credits == −1** →
   create the card in that slot (Blocked → not draggable), `left −= cost`; **else the unit is skipped** and the loop
   continues (a later cheaper unit can still fit).
3. Aje + includeBuildings → collector in slot 24, fixed, not draggable; its price is **not** subtracted from `left`
   (the gift covers it later) [bug: step 4 may spend those 250 → negative points left].
4. For food, wood, stone (order): if resPreset: `a = GetValueI(res, 0)`; −1 → disable both buttons, a = 0; if
   credits ≠ −1: `a = min(a, floor(left / rate))`, `left −= ceil(rate × a)`. Label = a; min = a. MP: min = 30/0/0.
   No resPreset → a = 0. **Leftover points are not converted into resources** (the forced-minimum code PD:220-222 is
   commented out); they simply stay unspent.

## 7. Campaign
* Menu (CM): the level list comes from the user profile `Campaign/Levels`, synchronised from CT by
  `CheckUserProfile` (CMG:40-84: missing levels inserted, existing profile values kept). Per level: `enabled`,
  `PB_Available`, `Credits`, `MinCredits`. **Budget = max(Credits, MinCredits)** (CM:141-147). CT: tutorial/
  single_01 PB 0; MinCredits single_02 2450, 03 3000, 04 2000, 05 2200, 06 3000, 07 2500, 08 4000, 09 3000, 10 4700,
  11 3000, 12 6000, 13 7000, 14 5500, 15 7000, 16 9000; all `Credits = 0` (CT:3-104). The level's `SPCredits` is
  ignored (GIW:363 commented).
* "My Army" tab is added only if PB_Available (GIW:290-299, CM:178); Start with the info tab open first switches to
  "My Army" (CM:199-206). Tribe radio buttons Hu/Aje/Ninigi enabled per `Player_0/Restrictions/Base/Tribes`; changing
  writes `Tribes/Default` and reloads (CM:353-363, 437-449).
* `GIW.UpdatePointBuy(tribe)` (GIW:343-397): owner = the player slot's owner; preset = `PlayerSettings/
  Player_<owner>/PointBuyPreset/<tribe>` (the tribe-less top-level `PointBuyPreset` entries are ignored by the
  client); resources = `…/Restrictions/Resources`; restrictions = `…/Restrictions`; IncludeBuildings. Gifts: Aje
  collector only. Preset units **fixed and paid from the budget**; a unit that no longer fits is dropped (§6).
  Example single_16: Bela/Stina/Cole in L3 (3 × 2000) + lovelace L1 (600) leave 2400 of 9000.
* Start (CM:208-220): `WriteResultToLevelInfo(0, Tribes/Default)` → `CCampaignMgr.GetCurLevelInfo()
  .SetPointBuyResult(owner, tribe, result)` (GIW:430-431; no empty check in SP). Result = `AddChar(class, slot)` per
  card (slot order) + food, wood, stone, iron 0 (PD:381-392). What SetPointBuyResult writes is [?engine] (SL then
  reads `PlayerSettings/Player_<owner>/PointBuyPreset/<tribe>` and `Restrictions/Resources`). The menu also calls it
  for non-PB levels with budget 0 → only zero-cost preset cards would survive [?engine: presumably ignored there].
* **Where Credits come from**: `CCampaignMgr.OnLevelWin` (CMG:145-183, from EndScreen): next level (profile order;
  after single_04 always single_05) gets `enabled = 1` and `Credits = max(old Credits, BoniTotal)`, where BoniTotal
  (level attribute) is the sum of `GiveBoni` trigger actions (AF:562-586) and accomplished quests' bonus for the
  current difficulty (`GetBoniEasy/Middle/Hard`, AF:2581-2600). So replaying never lowers the budget.

## 8. AI
* File: `<Tribe>/AiPBPreset<sub><Difficulty>.txt` under `Ai/settings` (AIC:148-155; called by the engine
  `OnCreatePointBuyPreset`). `<Difficulty>` = `Easy` (difficulty 0-2), `Medium` (3-5), `Hard` (6-9+) (AIC:159-187).
  `<sub>` = `D1..D4` (Dodo/offensive), `S1..S4` (Schnecke), `G1..G4` (Giraffe), `S5` (Turtle), `G1` (Singleplayer),
  random per game (AIC:290-445; default "1"). Only `Aje/` has files (D1-D4 × Easy/Medium/Hard + plain, G1 Easy/Hard +
  plain, G2-G4/S1-S4 plain); the root has generic D1-D3/G1/S1 (four distinct contents; with and without
  difficulty). Missing names → fallback [?engine] (probably the root file, then without suffix).
* Format: `Root { <tier> { Chars { <key> = class } Resources { food, wood, stone, iron } } }`, tiers −1 (Aje only:
  3 workers + 200/150/100), 500, 1000, 2000, 3000, 10000, 100000 (Aje only), 1000000. Aje keys are slot ids (level by
  slot); generic files use 1..n with generic classes `worker` / `warrior` / `scout` / heroes — mapping to
  `<tribe>_<x>` is [?engine] (SL maps only `worker`). [bug] `Aje/AiPBPresetG1.txt` has two `100000` tiers (second
  meant 10000).
* Tier choice [?engine]: Aje Hard tiers 1000/3000/10000 cost exactly tier + 30, i.e. tier = game credits (−1 =
  Predefined). AI armies are never validated (SL:661 excludes AI); in campaigns the AI uses its level data.

## 9. Server: validation and placement (SL:384-689, short)
* IncludeBuildings (player node and start-location base node): main building; Aje collector only for AI or credits −1
  (humans get it as the slot-24 card). `ignore_pointbuy` on the start location skips everything below.
* MP with credits −1: `PointBuyPreset/<tribe>` and `Restrictions/Resources` replaced by DP `_pb_locked`.
* Units from `PointBuyPreset/<tribe>`: generic → `<tribe>_worker` with caste (SEAS → seas_worker), `Stina_s0` →
  `special_eusmilus`, `Blocked` skipped, CorrectLevelToMinLevel, create, `clientpyramid_slotid = slot`, placement by
  caste around the start, `SetLevelClean(level)`; used += NPC price at the object's **actual** level
  (path `Units/<tribe>/<Animals|Vehicles|Character>/<class>` or `Units/Heroes/<class>`, SL:746-763).
* Resources set from `Restrictions/Resources` (`/Hu` sub-node overrides); used += **trunc**(amount × rate) per
  resource (client uses ceil → server is up to 1 point/resource more lenient).
* available = credits + 250 if Aje (regardless of IncludeBuildings [bug]) + 30. MP human with credits > −1 and
  (used > available or food < 30) → cheater: resources 0, all created units `Die()`, one `<tribe>_worker`
  (+ Aje collector) at the start position.

## 10. UI strings and art
Strings (English from `locale/uk/Texts/main_uk.ltf`): `_MyArmy` "My Army", `_UI_Tab_MyArmy_TT`,
`_UI_ShopList_Tab_{Infantry,Cavalry,Heroes}`, `_UI_Tab_{Infantry,Cavalry,Heroes}_TT`, `_UI_AC_PointBuy_Arrow_<0..4>_TT`
("Buy the selected unit at level n for the displayed amount of points."), `_UI_AC_PointBuy_Resource_Buy_<0..5>`,
`_UI_AC_PointBuy_Card`, `_UI_AC_PointBuy_Card_Locked`, `_UI_PBMenu_Button_Default`, `_UI_AC_PointBuy_Default_TT`,
`_PointBuyMenu_Clear`, `_UI_AC_PointBuy_Clear`, `_PointBuyMenu_PointGauge` "%1 of %2 points",
`_PointBuyMenu_PoinBuyIsEmpty` "no units or resources chosen" (MP Ready with empty result, PIS:896-899, GIW:433-443),
`_pb_locked` "Predefined", `_pb_boomer` "Boomer", `_pb_rusher` "Rusher", `_pb_standard` "Standard",
`_pb_<type>_<cost>_<tribe>`, preset window (PresetWindow.srf): `_UI_PresWind_Title_Presets`, `_Label_Tribe`,
`_Label_Preset`, `_List_Tribe_TT`, `_Edit_Name_TT`, `_Button_Save(_TT)`, `_Button_Delete(_TT)` ("Default presets may
not be deleted."), `_Button_RestoreDefaults(_TT)`, `_PointGauge_TT`; `_Game_Error` / `_WriteFileFailed` on save
failure; `_UI_GameInfo_Label_Points` (GIW:154); `_LOCKED_STANDARD_PRESET` (LSP:172).
Layout: PointBuyMenu.srf = x-layout [box 288 wide: Pyramid 630 high] + [ShoppingList 250]; GIW grows 310 → 610
wide on the army tab (GIW:325-331); MP preset window 350×420 at (640,30) (NMP:29-33); left strip 26×540 at (9,2)
blend `"16, layer pyramid_bg_avail, vslice pyramid_bg_noavail 65, layer pyramid_ovl_levelupable"` (PD:44-53).
Art (AD layer → file; **existence in the uploads**):
| layer / file | AD | exists |
|---|---|---|
| `menue/controls/pointbuy_addarrow{,_down,_hover,_disabled}.tga` (direct paths, PD:112) | – | no |
| `pointbuy_res0..5{,_down,_disable}` → `menue/controls/pointbuy_resources.tga` (y 0/37/74, x 0,35,68,101,134,167) | AD:2625-2644 | no |
| `pointgauge_empty` / `pointgauge_full` (280×35) → `menue/controls/pointgauge_{empty,full}.tga` | AD:2616-2622 | no |
| `pyramid_bg_*`, `pyramid_ovl_{locked,levelupable}` (32×545 strips) → `hud/pyrabutton_all.tga` | AD:2593-2606 | yes |
| `card_fixed` per level → `hud/cards/cards_layers_lvl{12,3,4,5}.tga` | AD:1558-1672 | yes |
| `card_frame`, `card_frame_hover`, unit icon layers | AD (cards) | yes |
| `hud/pyramid_open.tga` (pyramid background, NP:1409) | – | yes |
| `tribeicon_{Aje,Ninigi,Hu,Seas,Random}` (38×21, tribe drop list PW:161) → `menue/decoration/menu_tribeselecticons.tga` | AD:3100-3106 | yes |
| MIRAGE `pointbuy_res6/7` → `menue/controls/pointbuy_resource_skull.tga` (unused) | MIRAGE AD | yes (MIRAGE) |
`find Data -iname "*pointbuy*" -o -iname "*pyramid*"` finds only the scripts, the three pyramid sounds, the two
`hud/pyramid_*.tga` and MIRAGE's skull sheet: the remake must redraw the arrows, resource buttons and gauge.

## 11. What the remake does

* Data: `pipeline/build_data.py point_buy` → gamedata `pointBuy` {costs, cats, heroes, rates, presets} from the
  configuration's NewPointBuyCosts.txt (the official game: BoosterPack1's) and DefPresets.txt;
  `pipeline/build_ai.py point_buy` keeps the AiPBPreset entries' slot keys (`chars: {slot: class}`). The art
  (`menue/controls/pointbuy_*`, `pointgauge_*`) comes with the menu step (all of `UI/menue`).
* `src/game/pointbuy.js` (`PointBuy`): prices (§2), resource costs and amounts (§3.1), the shop (§4, the global
  tech tree; Stina as `special_eusmilus`), FindFreeSlot (first free slot, the highest ids blocked first), buy / buy at
  the lowest level / sell / move (§1.4-1.6; **deviation**: moving onto another card also checks that card's new price
  and its fixed level, so the points never go negative), resources with Shift / Ctrl steps (§3.2), presets (§5: the
  default ones of exactly the budget; **SEAS** has none: a made-up Standard of three workers and the rest as
  resources), `load` = LoadPreset (§6), `clear` (§1.6), the computer players' preset (§8: `<Tribe>/<sub><Difficulty>`,
  `<sub>`, the generic files, then G1; the tier = the budget, else the largest below it [?engine]; generic `warrior` /
  `scout` → the tribe's own or its first infantry / cavalry unit with a level 1 price [?engine]), `place` = the
  server's placement and check (§9: by caste, CorrectLevelToMinLevel, the cheater penalty for the human).
* Skirmish (`main.js skirmishPlayers`): points −1 = `_pb_locked` (as before); with points the human's army is the
  setup's own army (`slots[0].army`, made on the "My Army" page) or the chosen default preset (Standard / Boomer /
  Rusher); a human Aje gets no collector building, the collector card is it. A computer player buys when its brain
  starts (its sub-strategy is chosen then: `TribeAI.sub`). The setup's default is 1000 points.
* `src/ui/pointbuy.js` "My Army": the HUD pyramid's cells (slot ids in the HUD's cell order), drag and drop (out of
  the pyramid = sell), right click = sell, the five arrows with the selected unit's prices, the resource buttons of
  `pointbuy_resources.tga`, the gauge "%1 of %2 points", the shop tabs (double click buys), the description, Clear
  (multiplayer) / Default (campaign), presets with own ones in the browser (`localStorage pwr.pbPresets`; the
  original's Restore Defaults is not needed: the default presets are never overwritten).
* Campaign (`ui/menu.js campaignArmy`): every mission with PB_Available opens the army screen before it starts (also
  "Continue" on the end screen). Budget = max(credits, MinCredits) (§7); credits = the bonus points (`C.boni`) of the
  mission won before, never lowered (`main.js G.endMission`, `settings.campaign.credits`). The level's preset of the
  player's tribe (another tribe than the mission's: the equivalents, `campaign/tribes.js`), fixed; the shop limited
  to the level's Infantry / Cavalry / Heroes lists; the level limits (`unit_limits` Max) block slots. **Deviation**: a
  resource of −1 (missions 4, 5, 9, 11, 16) is locked at the tribe's start stock instead of 0 [?engine]. The army goes
  to the mission as `cfg.army` (`campaign/setup.js startLocation`). URL starts (`?campaign=n`, tests) keep the level's
  preset army without the screen.
