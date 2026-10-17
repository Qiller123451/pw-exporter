# UI groups 7–9 — diplomacy, tribute, chat, statistics, end screen, replays, point buy, credits, skirmish setup
# (the original, the plan, and what the remake does: §13)

Compares the original client/server scripts with the remake and plans the missing parts. Companion to
[ai.md](ai.md), [ai_group6.md](ai_group6.md) (the AI chat answers), [triggers.md](triggers.md) (campaign start army),
[economy.md](economy.md) (point-buy resource prices).

**Sources.** Original: `Data/Base/Scripts/` (paths below are relative to it), texts `Data/locale/uk/Texts/*.ltf`,
art `Data/Base/UI/` (`hud/`, `menue/`, atlas `All_def.txt`), engine strings `bin/PWClient.exe`, `bin/PWServer.exe`.
BoosterPack1 only adds rows to `Server/settings/NewPointBuyCosts.txt` (hu_undead_warrior, *_flamethrower, more heroes);
MIRAGE / BoosterPack3 / Wintermod have **no client UI scripts** — nothing in this document is overridden by a mod.

**Tags.** `[?engine]` behaviour inside the C++ engine (only the call is visible). `[MP]` only meaningful with more
than one human (network game) — no single-player equivalent. `[bug]` / `[dead]` defects or unreachable code of the
original. Localisation keys are given as `_KEY` = "UK text".

| short | file | short | file |
|---|---|---|---|
| DW | Game/UI/DiplomacyWindow.usl | PDS | Game/UI/PlayerDiplomacySlot.srf |
| CW | Game/UI/ChatWindow.usl | IS | Game/UI/IngameScreen.usl |
| G | Game/Game.usl | KEYS | Game/options/Keys.srf |
| ES | Game/UI/EndScreen.usl (+ .srf) | SS | Game/UI/StatisticScreen.usl |
| LGM | Game/UI/LoadGameMenu.usl | MM | Game/UI/MainMenu.usl |
| UISM | Game/mgr/UIStateMgr.usl | HW | Game/UI/HistoryWindow.usl |
| LSP | Game/UI/LevelSettingsPage.usl (+ .srf) | PIS | Game/UI/PlayerInfoSlot.usl |
| PLW | Game/UI/PlayerListWindow.usl (+ .srf) | GIW | Game/UI/GameInfoWindow.usl |
| PBM | Game/UI/PointBuy/PointBuyMenu.usl | PD | Game/UI/PointBuy/PyramidDialog.usl |
| PW | Game/UI/PointBuy/PresetWindow.usl | SHL | Game/UI/PointBuy/ShoppingList.usl |
| CM | Game/UI/CampaignMenu.usl | DP | Game/misc/DefPresets.txt |
| SA | Server/ServerApp.usl | GOM | Server/misc/GameOverMgr.usl |
| SL | Server/classes/misc/StartLocation.usl | STM | Server/misc/StatsMgr.usl |
| FO | Server/classes/FightingObj/FightingObj.usl | CF | Server/misc/ConditionFactory.usl |
| NPC | Server/settings/NewPointBuyCosts.txt | TT | Server/settings/Techtree/_TechTree.ttree |
| AIC | Ai/Modules/AiModuleControlDefault.usl | AIS | Ai/settings/[<Tribe>/]AiPBPreset*.txt |

Remake files are under `remake/src/` unless noted.

---------------------------------------------------------------------------------------------------------------

## 0. Overview

| # | feature | original | remake today | gap | [MP]? |
|---|---|---|---|---|---|
| 7a | diplomacy window | per-player Friend/Neutral/Enemy radio + their opinion; lockable | relations model exists (player.js, scripting.js); no window; HUD slot "diplomacy" empty | **M** (window + rules) | partly (only useful with ≥3 players or allies) |
| 7b | tribute | send food/wood/stone to anyone, no fee, clamped to stock, receiver cap ignored | AI side only (ai/chat.js gives 100) | **S** | no (works vs AI) |
| 7c | chat | chat bar To all / allies / enemies / whisper; Enter / Ctrl+Enter / Shift+Enter; history (RMB) | AI answers exist (ai/chat.js) but no input; ticker shows AI lines | **S–M** | whisper & human chat [MP] |
| 7d | statistics | 7–8 tab tables + time-line graph, per player | only kills / lost / time / epoch on end screen | **M–L** | no |
| 7e | end screen | Retry/Continue, Load Game, Save Replay, View Statistics, Back to Main menu, Quit to Windows; game paused | Victory/Defeat window with Keep playing / Play again / Main menu | **S** | no |
| 7f | replays | engine command recording `.rpl`, dev-flag only | none | **L** (needs deterministic sim) | no |
| 8a | point-buy army | Points: Predefined / 1000 / 3000 / 10000 (/100000); "My Army" tab (pyramid, shop, resources, presets) | fixed `_pb_locked` start (main.js) ; campaign uses preset army (setup.js) | **L** | no |
| 8b | credits | Bink film `credits.bik` from the main menu | none | **S** (film convert + button) | no |
| 9 | skirmish setup | 1–8 slots, 3 game modes, teams, per-slot AI type & level 0–9, colour, HQ, handicap, 6 options | 1 human + 1 AI, easy/normal/hard, random personality, warp gate toggle | **L** (foundation for 7a–7d) | no |

Recommended order: **9 (N players, teams) → 7e → 7c → 7a/7b → 7d → 8a → 8b → 7f (optional)**.

---------------------------------------------------------------------------------------------------------------

## 1. Group 7a — Diplomacy window

### 1.1 Original
- **Opening.** Top-bar button "Diplomacy" (`_UI_IngaScre_Button_Diplomacy`, art `hud/menu_alliesbutton*.tga`, 91 px,
  right of the quest button) IS:327-341 → `OpenDiplomacyWindow` IS:1286-1291 (modal). Enabled **only when the map
  type is `multiplayer`** and the client has a slot (`CheckDiplomacyButton` IS:737-757) — never in campaign
  missions. (`TopBar.usl:60` also creates one; TopBar is the older bar.)
- **Window** `CDiplomacyWindow` DW:243-342, layout DiplomacyWindow.srf: 800×400, caption `_PlayersWindow_Title_Diplomacy`
  = "Diplomacy", centred (DW:276-277), header row: Player / Team / Color / Friend / Neutral / Enemy / Status /
  Tribute (`_PlayersWindow_*`). One row per **other** slot, `Row_Player_1..7` (DW:290-318); free slots hidden
  (DW:320-334); "Close" button (`_PlayersWindow_Button_Close`).
- **Row** `CPlayerDiplomacySlot` DW:3-240, PDS (proportional boxes): Name 0.15 · Team 0.06 · Color swatch 0.06
  (`fill TeamCol <color>` 15×15, DW:190-192) · Friend / Neutral / Enemy radio 0.08 each · Status 0.1 · tribute type
  drop list 0.1 · amount edit 0.08 · Send 0.1 · Request 0.1. Closed slots hide everything but the name (DW:176-186).
- **Semantics** (directional, as the remake's `Player.rel`): the radios set **my opinion of them**
  (`SetMyOpinion(owner, 0|1|2)` DW:155-172); "Status" shows **their opinion of me** (`GetTheirOpinion`, coloured
  red "Enemy" / white "Neutral" / green "Friend" / "Unknown", `_UI_DiplWind_Option_*`, DW:195-211). The radios are
  re-read from `GetMyOpinion` on every `m_xOnUpdate` of the diplomacy manager (DW:274) [?engine sync].
- **Announcement.** A change also sends `GenericEvent "DiplomacyChange&me&them&status"` (DW:170) → SA:710-737 prints
  to **all** players `_NT_DiplChangeEnemy` "%1 has declared war on %2" / `_NT_DiplChangeNeutral` "%1 has adopted a
  neutral position to %2" / `_NT_DiplChangeAlly` "%1 is now an ally of %2", then `Evt_OnDiplomacyChanged` (DIPL
  trigger conditions).
- **Locks.** Radios disabled when game attribute `DiplomacyLocked` = 1 (DW:58-63, 231-236) or game type 1
  (Domination; comment says "TeamGame", DW:224-229). Domination and Defender force the lock on in the setup
  (LSP:159-164, 322-339).
- **Start relations** (skirmish/multiplayer): same team → 2 (friend), different team → 0 (enemy), both
  directions (SA:555-589). Campaign maps use `PlayerSettings/Player_i/Diplomacy` strings (SA:539-551).
- **Attacking a non-enemy** (FO:6594-6618): single player → refused if either side is a friend
  (`_NT_DiplAttackNonEnemyIsNotAllowed`); multiplayer → refused only if `DiplomacyLocked` and I am their friend;
  otherwise both relations become 0 and everybody sees `_NT_DiplChangeEnemyAttacked`.
- **Allied victory** (GOM:575-611): the end check uses **slot teams**, not diplomacy: last alive player wins, or
  all alive players win when only one team is left. Exception: the **warp-gate** victory (GOM:474-495) makes every
  alive player the gate owner considers a friend (`GetIsFriend(owner, i)`) win and kills the rest. So two
  players of different teams who ally in the window still have to fight it out — [bug-ish design]; Domination
  uses teams (GOM:497-527).
- Game types and `DiplomacyLocked` also gate trigger condition `DIPL` (CF:2679).

### 1.2 Remake
- `game/player.js` `relation / setRelation / isFriend / isEnemy` (41-56): directional table, skirmish falls back to
  `team`. `game/scripting.js` `setDiplomacy`, `attackAllowed`, `declareWar` (14-40) emit `diplomacy` events;
  `ui/feedback.js:193` says "You are now at war with …" on `attacked`.
- `ui/hud.js` `slot('diplomacy', el)` positions a top-bar button at x 789 (108-111) — nothing uses it.
- `main.js checkEnd` (875-892): won = every other player defeated **or my friend** (relations, not teams) — differs.

### 1.3 Plan
1. `src/ui/diplomacy.js` (new) `class DiplomacyWindow` — menu-frame window 800×400 like DiplomacyWindow.srf; rows
   for `W.players` minus `G.me` (no wildlife player), columns as in PDS. Radios call
   `G.world.setDiplomacy(G.me, p, rel)` (one direction, as SetMyOpinion); Status = `p.relation(G.me)`.
2. Lock: `G.world.rules.diplomacyLocked` (from setup §10) or game mode `domination`/`defender` → radios disabled.
   Button disabled for campaign / sequel (IS:749 `MapType != multiplayer`).
3. Announce: on change `W.emit('msg', {player: all, key: '_NT_DiplChange'+..., arg: [a.name, b.name]})`
   (feedback.js `ticker` needs `%2` support — today it only replaces `%1`).
4. `scripting.attackAllowed` multiplayer branch: allow attacking a neutral/friend unless locked & friend
   (FO:6607-6612); keep single-player rule for campaign.
5. Fix `checkEnd`: port GOM teams logic (team list from setup), warp gate keeps `isFriend` (world.js:299 already).
6. HUD: `hud.js buildTop` creates the button with `hud_menu_alliesbutton*.png` (already exported by
   `pipeline/build_ui.py`, which copies all of `UI/hud`) and label `_UI_IngaScre_Button_Diplomacy`.
7. AI reaction to diplomacy changes: the original AI reads relations each think [?engine]; the remake brains already
   query `p.isEnemy` — verify `census`/targets refresh after a change.

---------------------------------------------------------------------------------------------------------------

## 2. Group 7b — Tribute

### 2.1 Original
- **UI** in each diplomacy row (DW:43-54, 133-153): type drop list = the own tribe's
  `Server/settings/<Tribe>/Resources.txt` `Available` entries **except `iron`** → Food, Wood, Stone
  (`_UI_DiplWind_food|wood|stone`; `_UI_DiplWind_iron` = "Skulls" exists but is never listed). Amount edit: start
  "0", **max 5 characters** (≤ 99 999), non-digits stripped (only the last typed character is checked, DW:90-100
  [bug]: pasted text keeps non-digits; `ToInt` then reads the leading number).
- **Send** (DW:72-88): two messages — `AiGenericStringEvent "<me> AI<them>: Gift <type> <n>"` (the AI thanks:
  AIC:642-645 `_NT_AI_THANKSFORHELP`) and `GenericEvent "Tribute&me&them&n&type"` → server `TransferTribute`
  SA:796-836:
  - amount ≤ 0 → ignored; amount > own stock → **clamped to the stock** (you can give everything away);
  - **no fee / tax, no alliance requirement (enemies can be paid), no cooldown, no epoch requirement**;
  - receiver storage cap (`max_<res>`) **not applied** (code commented "kinda anoying", SA:814-819): the receiver
    can go above its storage limit;
  - receiver gets `_NT_DiplTribute` "You received %2 %1 from player %3" (SA:828);
  - stats: `CStatsMgr.AddTribute` (feeds trigger condition `TRIB`, CF:3152-3210, STM:30-42) and statistic samples
    `Tribute` +n for the sender, −n for the receiver (SA:832-834); game log line.
- **Request** (DW:102-121): `AiGenericStringEvent "<me> AI<them>: <type> <n>"` — the AI ignores the amount and sends a
  **fixed 100** if it has ≥ 100 unlocked and is not hostile (AIC:683-720; `_NT_AI_SEND*` / `_NT_AI_CANTSEND*` /
  `_NT_AI_DENIEHELPENEMY`); plus a chat line to the slot owner `_NT_DiplTributeRequest` "Please send me %1 %2"
  [MP for humans]. [bug] The receiver gets the raw resource id ("food"), only the local echo is localised
  (DW:116-119); `_NT_DiplTributeRequestSent` is unused [dead].
- [bug] `STM` names skulls `scalps` but the UI never sends iron/skulls, so a `TRIB` condition on scalps can never
  fire. [bug] The AI dedupes by the whole message string (AIC:616-618): the same request twice in a row is ignored.
  `GetWantedAi` only knows `AI1:`…`AI7:` (AIC:746-764); an unknown target falls to 0.

### 2.2 Remake
- `game/ai/chat.js onPlayerRequest(from, word)` (29-55): gift → thanks; food/wood/stone → 100 if available above
  its reserve, using `from.deliver` (**applies the storage cap** — the original's AI `GiveResourcesTo` is
  [?engine]); help → support squad. Not wired to any UI.
- No player-to-player transfer function.

### 2.3 Plan
1. `game/scripting.js` add `tribute(from, to, res, n)`: `n = min(n, from.res[res])`, `n <= 0` → no-op;
   `from.res[res] -= n; to.res[res] += n` **without cap** (SA:816-821); push `from.log`? no (not income);
   `emit('tribute', {from, to, res, n})` and `emit('msg', {player: to, key: '_NT_DiplTribute', arg: [res, n, from.name]})`.
   Resources: food, wood, stone only.
2. Diplomacy row (§1.3): type `<select>` + numeric input (maxlength 5) + Send / Request. Send → `tribute()` then
   `brainOf(to)?.onPlayerRequest(G.me, 'gift')`. Request → `brainOf(to)?.onPlayerRequest(G.me, res)` (amount
   ignored, as the original).
3. Stats hook (§4): `tribute` event → sender `tributeSent += n`, receiver `tributeReceived += n`.
4. Campaign `TRIB` condition (`game/campaign/conditions.js`) can subscribe to `tribute` (currently not implemented;
   no campaign map uses it [check with the triggers census before porting]).

---------------------------------------------------------------------------------------------------------------

## 3. Group 7c — In-game chat

### 3.1 Original
- **Opening.** Top-bar "Chat" button (`hud/menu_chatbutton*.tga`, 80 px, right of Diplomacy; IS:342-358): LMB →
  chat to all, **RMB → history window** (`_UI_IngaScre_Button_Chat_TT` "RMB-Click: Open history.", IS:351,
  437-446). Keys (KEYS:27-29, G:156-158, 2462-2480): **Enter** = to all, **Ctrl+Enter** = to allies,
  **Shift+Enter** = to enemies. The chat works on every map type (no multiplayer check).
- **Chat bar** `CIngameChatBar` CW:16-349 (ChatWindow.srf `IngameChatWindow`): 550×50, centred horizontally at
  y = H − H/3.5 (CW:77-78), frame "Custom1"; modal. Controls: target drop list (0.2), edit (0.575, **150 chars**),
  Send (`_UI_ChatWind_Button_Send`). Targets: `_UI_ChatWind_Option_ToAll` "To All", `…ToAllies` "To Allies",
  `…ToEnemies` "To Enemies", then the names of the other **human** slots (CW:43-61). Esc closes, Enter sends.
- **Send** (CW:112-161), in this order:
  1. `/whisper <name> <text>` and `/who <name>` commands (CW:168-223): name matched case-insensitively by prefix
     against slot names; errors `_UI_ChatWind_Msg_Playernamenotfound`, `…_Youcantwhispertoyourself`; `/who` prints
     the literal "&ShowStats(name)" [dead stub] plus developer easter eggs (CW:206-209). Unknown command → falls
     through as normal text.
  2. "To Allies": sent to every slot with **my opinion = 2** as " to allies: <text>" (`_UI_ChatWind_Msg_To_Allies`),
     local echo "You announced to your allies: " (CW:271-296). "To Enemies": opinion 0 (CW:298-322); neutrals get
     neither.
  3. A player name: whisper (CW:127-144, 263-269) — "You told X: …" / " whispers: …" [MP].
  4. "To All": if the first word is `AI1:`…`AI7:` the whole line also goes to the AIs as
     `AiGenericStringEvent "<me> <text>"` (CW:147-153) → AIC:615-731 (help / food / wood / stone / gift; anything
     else → the Eliza chatbot [?engine]); then `CEvt_ChatMsg ": <text>"` to everyone (the engine prepends the
     sender's name [?engine]). So **AI requests only work in "To All" mode** [bug-ish].
- **Display.** Received lines go to the news ticker (`CFeedback.Print(NTT_Chat)` CW:324-343) — in game IS:709-735
  splits them into **40-character lines**; prefix characters `! & § $` mark whisper / system / allies / enemies
  (the colouring code is commented out [dead]). `CIngameChatOutput` (CW:356-437: 400 px box at 5,35, lines expire
  after 8 s) is never created [dead].
- **History** `CHistoryWindow` HW:1-109: 765×515, news-ticker history with "auto scroll" checkbox.
- `CNewChatWindow` (CW:439-823) is the **lobby** chat of the multiplayer pre-game window [MP]
  (NewMultiPlayerPreGameWindow.usl:64), with "Send to All / Allies / Enemies" (`_UI_ChatWind_Option_SendTo*`).

### 3.2 Remake
- `game/ai/chat.js` answers `onPlayerRequest(from, word)` and cries for help; `ui/feedback.js ticker` (24-33) shows
  "<AI name>: <text>". No input UI; `hud.js slot('chat')` (x 869) unused. No history window.

### 3.3 Plan
1. `src/ui/chat.js` (new): `ChatBar` (550×50 at the original position), `<select>` To all / To allies / To enemies
   (+ human names: none in single player), `<input maxlength=150>`. Keys in `ui/input.js`: Enter / Ctrl+Enter /
   Shift+Enter open it with the target preselected; Esc closes; Enter sends.
2. Parse "AI<n>: <word> …": map `<n>` to the player **id** (original slot owner id) → `G.brains.get(id)`
   `.onPlayerRequest(G.me, word)`; do it for every target mode (a deliberate fix — flag it in the code) or keep the
   original's "To All only" (decision §11).
3. Echo the own line to the ticker (`G.hud.message`), prefix "You announced to your allies: " etc.; split long
   lines at 40 chars like IS:727-734 (or let CSS wrap — remake choice).
4. `/whisper`, `/who`: skip (no humans) — keep a TODO for network play.
5. Eliza [?engine]: not portable from scripts; optional tiny canned-answer table or nothing (today: nothing).
6. History window: `ui/feedback.js` keeps the last N ticker lines (`this.history`), RMB on the chat button opens a
   765×515 list with "Auto scroll".
7. Button art `hud_menu_chatbutton*.png` (exported), label `_UI_IngaScre_Button_Chat`.

---------------------------------------------------------------------------------------------------------------

## 4. Group 7d — Game statistics

### 4.1 Original
- **Collection** is engine-side (`CStatisticMgr` server / `CStatisticMgrClient`), fed by scripts [?engine for the
  storage, sums and time series]:

  | sample (`CStatisticSample.*`) | where | value |
  |---|---|---|
  | Epoch | Server/classes/task/Action.usl:698-699 | new epoch 2..5 at the time it is reached |
  | unit add / remove (`AddUnit(owner, class, type, ±1)`) | Action.usl:903 (produced), FO:4001-4002 (died, counts-in-unit-limit only), SL:389 | categorised by the engine into Worker / Infantry / Animals / Vehicles / Ships [?engine] (the per-category `AddSample`s are commented out, Action.usl:906-928) |
  | EcoBuildings / MilBuildings / DefBuildings | Server/classes/task/BuildUpBuilding.usl:275-294 (+1 when finished), FO:3984-3995 (−1 when destroyed; palisades not counted as defence); SL:394-402 (start HQ) | by tech-tree `uiposition/subcat` ECON / COMB / DEFE |
  | RazedBuildings | FO:3973-3976 | +1 to the destroyer (not self) |
  | KilledEnemies | FO:3998-4000 | +1 to the killer (not self) |
  | KilledAnimals | FO:3971-3972 | +1 to the killer of an ownerless ANML |
  | Collected food/wood/stone | Server/misc/Player.usl:344-351 `AddFood/AddWood/AddStone(stored amount)` [?engine] | only what fitted into storage |
  | Collected_Skulls | FO:3967 **commented out** | [bug] skulls never counted → "Skulls" column/graph always 0 [?engine check] |
  | Tribute | SA:832-834 | +n sender, −n receiver |
  | QuestPointsMain / Sub | Server/misc/ActionFactory.usl:2590-2594 | player 0 only (campaign) |
  | OutOfGame | GOM:621 / 642 | +1 win, −1 loss; `SetWinner` |

- **Screen** `CStatisticScreen` SS:864-982: 930×580 centred, OK button (`_UI_StatScre_Button_OK`). Resource
  `StatisticScreen` (multiplayer map type) or `StatisticScreenSP`. Tabs (SS:953-962) with player name rows
  (`CPlayerListScreen`, 170 px) and columns (`CTablesScreen` SS:813-860, table 668×400 at x 185, row height 25,
  art `statistic_tablecolumnhead/row/end`):

  | tab (`_UI_StatScre_Tab_*`) | columns (`_UI_StatScre_Col_*`) |
  |---|---|
  | Overview | Economical · Units · Buildings · Invention (engine aggregates `Overview_*` [?engine]) |
  | Economical | Food · Wood · Stone · Skulls · Workers · Send Tribute (`Tributesend`) |
  | Military | Infantry · Animals · Vehicles · Ships built |
  | Buildings | Economy Buildings · Military Buildings · Defense Building |
  | Fights | Units lost · Buildings lost (shown as positive of the negative sum) · Enemies killed · Buildings destroyed · Animals killed |
  | Invention | Epoch 2 · Epoch 3 · Epoch 4 · Epoch 5 = time first reached (`h/min/s`, "failed" if never; SS:568-575, 613-630) |
  | Quest (single-player maps only) | Quests (All) · (Main) · (Bonus) |
  | Time line | graph |

  Values: `GetSumPos` of the column's sample (SS:576-578). Rows = players that exist (`PlayerExists`, up to 8).
- **Time line** `CGraphsScreen` SS:16-365: graph 668×372 at (165, 30), "Category:" drop list with 11 entries
  (SS:130-145): All units, All civilians, All military, All buildings, All resources, Food, Wood, Stone, Skulls (=
  current stock over time) and All resources total, Food/Wood/Stone/Skulls total (= cumulative collected,
  `GetSumPosAt`); one checkbox per player (all on), lines in the player colour, 4 vertical grid lines, 5 scale
  labels; x = first..last time stamp sampled every 2 px (SS:279-326); negative values clamped to 0 ("HACK").
- **Access**: only from the end screen's "View Statistics" (ES:210-222), enabled once `HasData()` (polled every
  250 ms, ES:249-256). `_UI_StatScre_Tab_Battles/Graphs`, `_UI_StatScre_Option_*`, `Upgrades`, `SpecialMoves`,
  `BestBoss`, `Tributereceived` keys exist but are unused [dead].

### 4.2 Remake
- `Player.kills / lost` (combat.js:716, 735), `incomePerMin` log (player.js:87-94). End screen shows time, kills,
  lost, epoch (menu.js:546-547). No time series, no per-player table.

### 4.3 Plan
1. `src/game/stats.js` (new) `class Stats`: per player counters + time series sampled every 10 s game time (enough
   for 2-px graph resolution over long games). Subscribe in `World.update` event pass (like `campaign/engine.js`)
   to: `trained`/`spawned` (unit +1 by category: worker / infantry (CHTR) / animals (ANML) / vehicles (VHCL) /
   ships), `died` (unitsLost, killer `enemiesKilled` or `animalsKilled`), `destroyed` (buildingsLost,
   `razed` to the destroyer), `built` (eco / mil / def by `uiposition.subcat` from the tech tree; palisades
   excluded), `delivered` (food/wood/stone collected — use the amount actually stored, player.js `deliver`
   return), epoch (`upgrade` event for `age_n` or poll `p.epoch()`), `tribute`. Skulls: count skulls gained
   (the original's column is effectively 0 — decide: faithful 0 vs. real count; see §11).
2. Save it in `game/save.js` snapshot (`stats` block).
3. `src/ui/stats.js` (new) screen 930×580 with the tabs/columns above; graph via `<canvas>` 668×372; player colours
   from `PLAYER_COLORS`. Overview columns: define in the remake as sums (Economical = total collected,
   Units = units produced, Buildings = buildings built, Invention = highest epoch) — the engine formula is
   [?engine]; mark as approximation.
4. Export the table art: extend `pipeline/build_ui.py` (today it copies only `UI/hud` and atlas entries of those
   files) to also copy `menue/controls/statistic_*` / atlas sources `statistic_tablecolumn*`.

---------------------------------------------------------------------------------------------------------------

## 5. Group 7e — End screen

### 5.1 Original
- Triggered by server `GameOver\t<Campaign|Multiplayer>\t<Win|Lose>[\t<reason>]` (GOM:615-642, G:580-581) →
  `CEndScreen` ES:34-174 (EndScreen.srf: 320×500, centred): picture `menue/decoration/gameover_victory|defeat.tga`
  with `_EndScreen_YouWin` "You were victorious!" (green) / `_EndScreen_YouLose` "You have been defeated!" (red) and
  the reason text; caption `_EndScreen_Campaign` / `_Skirmish` / `_Multiplayer`. **The game is paused** while it is
  open (ES:173; unpaused on close).
- Buttons, top to bottom (srf order): **RetryContinue**, **LoadGame**, **SaveReplay**, **ViewStats**, **Back2Menu**,
  **Quit2Win**:

  | button | label | shown / enabled | action |
  |---|---|---|---|
  | RetryContinue | `_EndScreen_Retry` "Retry"; campaign win: `_EndScreen_Continue` "Continue" | visible only if the local client hosts and the level has < 2 human players (ES:67-75); campaign win: disabled when there is no next level (ES:93-95) | win in campaign → `STATE_CONTINUECAMPAIGN`; else `STATE_RELOADGAME` (restart the same level, ES:186-192) |
  | LoadGame | "Load Game" | hidden for multiplayer (ES:153, 159) | load menu (ES:205-208) |
  | SaveReplay | "Save Replay" | disabled unless config `Pest/Global/RecordReplay` and host (ES:64-71); hidden for campaign (ES:89) | save menu, replay tab (ES:244-247) |
  | ViewStats | "View Statistics" | disabled until statistics arrive (ES:168-172, 249-256) | §4 |
  | Back2Menu | "Back to Main menu" | always | close game, main menu |
  | Quit2Win | "Quit to Windows" | always | quit |

- **No "continue playing / keep watching"** option. Skirmish ends arrive as `Multiplayer` (GOM:617, 638 always send
  "Multiplayer"), so the `EST_SKIRMISH_*` branches (ES:99-106, 138-147) are [dead] and a skirmish shows caption
  "Multiplayer" and hides Load Game [bug]. Losers' remaining units are killed (GOM:654-673) and
  `_NT_DiplPlayerKilled` is printed to all (GOM:650).
- `_EndScreen_Quit`, `_EndScreen_TT_*` unused.

### 5.2 Remake
`ui/menu.js end(won, stats)` (523-553): victory/defeat picture, mission quests/points (campaign), table Time /
Enemies killed / Units lost / Epoch reached; buttons: Next mission (campaign win), **Keep playing** (skirmish, not
original), Try again / Play again, Main menu. Game not paused; no Load, Stats, Quit.

### 5.3 Plan (menu.js `end`)
1. Button set/order as the original: Retry|Continue · Load Game · (Save Replay hidden unless §8 is done) ·
   View Statistics (opens §4, returns to end screen) · Back to Main menu · Quit (only where `hooks.exit` exists).
   Labels from `_EndScreen_*` (gamedata ui texts).
2. Pause the simulation while the end screen is open (`G.paused = true`), unpause on close.
3. Keep "Keep playing" as a remake extra **only if the user wants it** (§11); default off to be faithful.
4. Caption: use "Skirmish" for skirmish (fixing the original's dead branch) — note the deviation.

---------------------------------------------------------------------------------------------------------------

## 6. Group 7f — Replays

### 6.1 Original
- Engine feature [?engine]: PWServer strings `StartReplayRecord`, `StartReplayPlayback`, `StopReplay`,
  `GetCurrentReplayMode`, config keys `Pest/Global/RecordReplay`, `ReplayCompression`, `Pest/Global/AutoStoreReplays`,
  `MaxNumAutoStoredReplays`, `MinSecsAutoStoredReplays`, auto files `autoreplay_*.rpl`; client events
  `CEvt_SaveReplay`, `CEvt_LoadReplay`; folder `<profile>/Replays/<user>/` (`GetReplayPath`, PWClient strings
  `Replays/default/`). File format: `.rpl`, undocumented (presumably the recorded command stream of the lockstep
  server) — not analysable from the scripts.
- UI: Load menu tab `_UI_LoadGame_Tab_Replay` (LGM:34, 78; list of `*.rpl`, date, delete, load → `CEvt_LoadReplay`
  LGM:686-783); save tab `_UI_LoadGame_Tab_SaveReplay` (LGM:83, 663-675: `<name>.rpl`, overwrite prompt). End of a
  replay: `GOM.OnPlayerDisconnect(-1)` sends `MainMenu` to all (GOM:271-273).
- Recording is **off by default**: the Save Replay button is only enabled with the developer config flag
  (ES:69); no playback controls (speed / seek / camera) exist in the scripts.

### 6.2 Remake
None. The simulation is not deterministic (many `Math.random()` calls in game/ and ai/), saves are full snapshots
(`game/save.js`).

### 6.3 Plan (optional)
- Faithful option: none needed (feature hidden in the shipped game).
- If wanted: (a) seeded PRNG for all game-state randomness (`game/rng.js`, replace `Math.random` in game/ and ai/),
  (b) record every `World.order`/build/research/diplomacy/tribute command with its tick, (c) `.rpl.json` =
  {config, seed, version, commands[]}, (d) playback = start the same config and inject commands, input disabled,
  speed control from `settings.speed`. Cost L; risk: any non-seeded randomness breaks sync. Cheaper alternative:
  periodic snapshots (save.js) as a "watch from checkpoint" — not a true replay.

---------------------------------------------------------------------------------------------------------------

## 7. Group 8a — Point-buy army

### 7.1 Original — budget and rules
- **Budget** ("Points" drop list in the setup, LSP:171-195): `_LOCKED_STANDARD_PRESET` "Predefined set" (= −1),
  1000, 3000, 10000, and 100000 only with profile `Multiplayer/Enable100k` = 1. **Default 1000**
  (`Multiplayer/Credits`, LSP:180, 519). Game info shows "Points" as max(credits, 0) (GIW:153-154).
- **Predefined (−1)**: every player (also AI) gets DP `<Tribe>/_pb_locked`: 3 workers + food 200, wood 150,
  stone 100, iron 0 (DP:4-17, 315-329, 618-632; no SEAS block — SEAS is excluded from the MP tribe list); army
  drop list shows only `_pb_locked` "Predefined" and is disabled (PIS:518-522, 582-583).
- **Bought army** (credits ≥ 0): the human player's own "My Army" tab; the AI uses `AIS` files
  `<Tribe>/AiPBPreset<sub-strategy><Easy|Medium|Hard>.txt` (AIC:148-155), tiers 500 / 1000 / 2000 / 3000 / 10000 /
  1000000 each with `Chars{n = class}` and `Resources{food, wood, stone, iron}` — tier choice [?engine]
  (presumably the largest tier ≤ credits). Remake data: `ai.json → pointBuy` (ai.md §4.7).
- **Free extras** (GIW:224-226, 399-424; SL:640-658): +30 points "gift" with a **minimum of 30 food** in multiplayer
  (`GIW_MP_GIFTED_FOOD`; PD:228-232 makes 30 food the floor), Aje additionally get their resource collector
  (fixed card in slot 24, not draggable, PD:187-194) with its level-1 price (NPC: `aje_resource_collector` 250)
  credited back.
- **Prices** NPC: `Units/<Tribe>/{Character,Animals,Vehicles}/<class>/Level1..5` and `Units/Heroes/<hero>/Level1..5`
  (heroes 600 / 1000 / 2000 / 4000 / 8000); e.g. hu_worker 60/100/170/300/700, hu_warrior 80/150/400/800/2000;
  missing `LevelN` = not buyable at that level. Resources `Resources/<Tribe>`: food 1.0, wood 1.5, stone 2.0,
  iron 100 per unit (client rounds **up** per purchase, PBM:287-294; server truncates the total, SL:625-630 [bug,
  off-by-one tolerance]). BoosterPack1 adds rows (undead warrior, flamethrowers, more heroes). The older
  `PointBuyCosts.txt` (flat res_0 / Bela_s0 …) is loaded by SL:413-417 but never used [dead].
- **Slots → levels** (PBM:231-245, SL:491-503): pyramid slots 0-24 level 1, 25-39 level 2, 40-47 level 3,
  48-50 level 4, 51 level 5; card cost = price at the slot's level. `CorrectLevelToMinLevel` raises units below
  their class minimum (SL:536). A hero may be bought once (PBM:128-136). Generic entries `worker` / `Nature` /
  `Technics` / `Resource` → `<tribe>_worker` with caste (SL:514-524); `Stina_s0` → `special_eusmilus`.
- **Server validation** (SL:440-689): sum of unit prices (by actual level) + resource prices; if
  `used > credits (+30, +Aje collector)` **or food < 30** for a human in multiplayer → "cheater": resources 0, all
  bought units die, one worker (+ Aje collector) is created instead (SL:661-688).
- Start placement: units around the start position by caste (res 0°, tec 120°, nat / Stina 240°, others random,
  SL:551-562); resources set from `Restrictions/Resources[/Hu]` (SL:604-623).

### 7.2 Original — UI
- **Setup screen**: `CGameInfoWindow` (GIW:196-468) left panel 310×715 at (30,30) with tab `_GameInfo` (map preview,
  description, the game settings list GIW:119-190); tab `_MyArmy` "My Army" added when point buy is available
  (GIW:290-303) — widens the window to 610×715 (GIW:325-331). Disabled while "Ready" or for tribe Random
  (PIS:866, 964).
- **My Army** `CPointBuyMenu` (PBM; PointBuyMenu.srf): left `CPyramidDialog` (PD) = the army pyramid in
  point-buy mode (`CNewPyramid.SetPointBuyMode`, drag cards in/out, PD:32-41), five "buy at level n" arrow
  buttons with the price (`pointbuy_addarrow`, x 220, y 431/281/177/99/25 for levels 1..5, PD:96-124,
  `_UI_AC_PointBuy_Arrow_<n>_TT`), resource row of 6 buttons sell/buy food, wood, stone at y 547 (PD:55-94,
  `_UI_AC_PointBuy_Resource_Buy_<0..5>`: click 1, Shift 10, Ctrl 100, Ctrl+Shift 1000 units, PD:430-480), "Default"
  / "Clear" button (PD:125-138); right `CShoppingList` (SHL) tabs Infantry / Cavalry / Heroes
  (`_UI_ShopList_Tab_*`), filtered by the map's `Restrictions/Chars/{Infantry,Cavalry,Heroes}/<Tribe>` (SHL:289-310);
  a point gauge "%1 of %2 points" (`_PointBuyMenu_PointGauge`). Drop a card outside the pyramid = sell (PBM:143-162).
- **Presets** `CPresetWindow` (PW): army drop list in the player row = presets of the tribe for exactly this budget
  (`Cost == credits`): DP `_pb_boomer_/_rusher_/_standard_<cost>_<tribe>` ("Boomer", "Rusher", "Standard") plus own
  presets saved to `<user settings>/PointBuyPresets/Presets.txt` (PW:60-62, 379-459); "restore defaults" reloads DP.
- **Ready** (PIS:855-945): the result is sent `CEvt_PointBuyResult(chars, resources)` (GIW:426-447); an empty
  result (no units and 0 resources) is refused `_PointBuyMenu_PoinBuyIsEmpty`. Tribe "Random" → presets only
  (`_pb_boomer` / `_pb_rusher` / `_pb_standard`, PIS:572-580) and the server picks the tribe.
- **Campaign**: the same `CGameInfoWindow` in `GIWT_SINGLEPLAYER` mode in the campaign menu (CM:141-220): levels with
  `PB_Available = 1` in `Server/settings/Campaigns.txt` (all but tutorial and single_01), budget
  `max(Credits, MinCredits)` where Credits = earned bonus points (triggers.md §6.1, §6.7).

### 7.3 Remake
- Skirmish start fixed to `_pb_locked` (main.js:458-494 via `rules.start(tribe)`, built by
  `pipeline/build_data.py:245-255`; SEAS gets 3 seas_worker + Hu resources — a remake guess).
- Campaign: `campaign/setup.js startLocation` (543-581) spawns the level's preset army; resources −1 → tribe
  default (guess); no army screen.
- AI `pointBuy` table exported but unused.

### 7.4 Plan
1. Data: export NPC (with BoosterPack1 rows per configuration) and DP presets into gamedata (`build_data.py`:
   `pointBuy: {costs, resources, presets}`); `rules.pointCost(cls, level, tribe)`.
2. `src/game/pointbuy.js` (new): `slotLevel(slot)`, `costOf(army)`, `validate(army, res, credits, tribe, mp)`
   (+30 gift, Aje collector, food ≥ 30, cheater fallback), `apply(player, army, res, startPos)` (placement by caste as
   SL:551-575; reuse `campaign/setup.js startLocation` placement code — move it to a shared helper).
3. AI: `TribeAI` start: pick `pointBuy[tribe|generic][<letter><sub><Class>]` tier ≤ credits (document as guess
   [?engine]); spawn its chars/resources.
4. UI `src/ui/pointbuy.js`: "My Army" panel in the skirmish setup (and campaign menu for PB missions): reuse the
   HUD pyramid (`hud.js` army pyramid has drag & drop) in a point-buy mode, shop list tabs from the tech tree
   (CHTR = Infantry, ANML+VHCL = Cavalry, heroes), resource buttons with the original modifiers, gauge, presets
   drop list (DP + localStorage `pwr.pbPresets`). Art: export `menue/controls/pointbuy_*` (extend build_ui.py).
5. Setup option "Points" (§10). Default: decide 1000 (original) vs. Predefined (current remake behaviour) — §11.
6. Campaign army screen for PB missions (4, 5, 9, 11, 16 at least) — separate follow-up, same components.

---------------------------------------------------------------------------------------------------------------

## 8. Group 8b — Credits

### 8.1 Original
- Main menu button "Credits" (MM:76-78) → `CClientWrap.PlayBink("credits.bik")` (MM:200-203; also
  `STATE_CREDITSSCREEN` UISM:617-620). The credits are **a pre-rendered Bink film** (text, music and scrolling are
  baked into the video) — no credits text in the scripts or locale files. PWClient also knows `intro.bik`,
  `extro.bik`, `partner.bik`, `sek_logo.bik`, `sf_logo.bik`.
- `credits.bik` is **not in the uploaded installation** (only `Data/Base/Video/hs_3010.bik`, `locale/pl/Video/hs_3010.bik`);
  on the user's PC it should be in `Data/Base/Video/` or `Data/locale/<lang>/Video/` [check on E:].

### 8.2 Remake
No credits button. Film pipeline exists: `pwexport/video.py` converts Bink → WebM, `films()` (91-96) only takes
`hs_*` / `ns_*`; `ui/mission.js` (574-631) plays films full screen.

### 8.3 Plan
1. `pwexport/video.py films()`: also accept `credits.bik` (and optionally `intro.bik` / `extro.bik`).
2. `ui/menu.js title()`: "Credits" button (`_UI_MainMenu_Button_Credits` "Credits", tooltip `_UI_MainMenu_Tooltip_Credits`; MainMenu.srf:84) → play
   `assets/video/credits.webm` with the mission film player (click / Esc skips); hide the button when the file is
   missing (HEAD request).
3. Optionally append a short remake-credits page after the film (deviation; ask).

---------------------------------------------------------------------------------------------------------------

## 9. (reserved) — game-over rules referenced by 7a/7e/9

GOM summary (needed for the modes in §10; the remake has only the warp gate):
- Enabled only on `Base/MapType = multiplayer` (GOM:93-103). Player alive at start if it has units counting in the
  unit limit or a unit-producing building (GOM:104-136).
- Checks: units (always), warp gate (always), **HQ** unless `Base/LastManStanding = 1` (GOM:138-148), domination
  (type 1), defender objects (type 2).
- **Killed** when it has no unit counting in the unit limit and no producing building (GOM:330-351), or when its
  main building (`hu_fireplace`, `ninigi_fireplace`, `aje_resource_collector`, `seas_headquarters`) is gone and a
  **HQ timer** (`Game/MPSettings/HQTimer`, default **5 min**, icon "headquater", tooltip `_Timer_TT_HeadQuater`) runs
  out without a new one being finished (GOM:353-410, 463-472).
- **Warp gate**: finished gate starts a timer `Game/MPSettings/WarpGateTimer` default **10 min**; at 0 the owner and
  its friends win, all others lose (GOM:412-495); gate destroyed → timer killed. `DimGateForbidden` hides the gate in
  the tech tree (`warpgate_invisible` filter, SL:691-711).
- **Domination** (type 1, "King of the Hill"): all `DOFL` flags owned by one team → timer
  `Game/MPSettings/DominationTimer` default **10 min**; mixed owners pause it, none kills it; at 0 that team wins
  (GOM:497-527, 676-805). Flags are deleted in other modes (GOM:169-177). [bug] "most owner" never updates `iTmp`
  (GOM:727-732) → the timer is credited to the last player id with ≥ 1 flag.
- **Defender** (type 2): slot with HQ 0 = defender (team 1), others team 2 (SA:503-517, PIS:1055-1061, 1134-1143);
  defender timer = setup value in minutes; at 0 the defender wins; all `defender_object`s destroyed → player **0**
  loses, all others win (GOM:807-879; hard-coded `i==0`, GOM:868 [bug if the defender is not owner 0 — owner = HQ so
  it is 0]). [bug] `CHECK_DEFENDEROBJS = 016h` overlaps the HQ and warp-gate bits (GOM:9-13), so the defender
  check is active in every mode (harmless: no `defender_object` outside Defender maps).
- Win/loss: last alive player, or last alive team (GOM:575-611; needs > 1 started player / team); losers' units and
  producing buildings die (GOM:654-673).

---------------------------------------------------------------------------------------------------------------

## 10. Group 9 — Skirmish setup

### 10.1 Original — flow
- Main menu "Skirmish" (visible only with config `Game/GUIOptions/MainMenuEnableSK`, MM:20, 54-61) →
  `SetSkirmishMode(true)` → the **LAN lobby / pre-game window in skirmish mode** (MM:140-145) — skirmish is a local
  multiplayer game; the map type is `multiplayer`, so all multiplayer rules (GOM, diplomacy window) apply.
- Pre-game window `CPlayerListWindow` (PLW, caption `_UI_PlLiWind_Title_Skirmish`) with tabs `_UI_PlLiWind_Tab_Players`
  and `_UI_PlLiWind_Tab_Settings` (PLW:213-219), plus the `CGameInfoWindow` (map info / My Army, §7.2). Buttons
  "Cancel Game" / "Start Game" (`_UI_PlLiWind_Button_*`). Start: when all slots ready → 5-s countdown
  (PLW:225, 273-322; "Abort Countdown").

### 10.2 Original — game settings (Settings tab, LSP; host values → game attributes LSP:500-524)

| setting | label key | values (default) | rules |
|---|---|---|---|
| Game type | `_UI_GamLWind_Label_GameType` | `_GAMETYPE_Deathmatch` "Deathmatch" (0), `_GAMETYPE_KingOfTheHill` "**Domination**" (1), `_GAMETYPE_Defender` "Defender" (2) (profile, default 0) LSP:73-80 | filters the map list by the map's game-type string (`Deathmatch`, `Domination`/`KingOfTheHill`, `Defender`, LSP:269-283); Domination: lock diplomacy forced on, warp gate default off; Defender: lock + Choose HQ forced on, warp gate default off (LSP:311-352) |
| Defender countdown | `_UI_PlLiWind_Label_DefenderTimer` | spin 5..300 step 5 min; default **45** in the page (LSP:85-89) but **10** in the host attribute (LSP:511) [bug] | only enabled for Defender |
| Players | `_UI_GamLWind_Label_Players` | 1..8 in skirmish (2..8 online) (default 2) LSP:134-149 | maps with `MaxPlayers < players` hidden |
| Teams | `_UI_GamLWind_Label_Teams` | 1..players, or 2..players when diplomacy is locked (CheckNumTeams LSP:453-474) (default 2) | lock-diplomacy checkbox disabled when teams = 1 (LSP:428) |
| Points | `_UI_GamLWind_Label_Points` | Predefined / 1000 / 3000 / 10000 (/100000) (default **1000**) | §7 |
| Disable warp gate | `_UI_GamLWind_Label_DisableWarpgate` | checkbox (Deathmatch off, others on) | `DimGateForbidden` |
| Disable fog of war | `_UI_GamLWind_Label_DisableFogofWar` | checkbox (off) | `FOWEnabled = !checked` [?engine fog] |
| Lock diplomacy settings | `_UI_GamLWind_Label_LockDiplomacySettings` | checkbox (off; forced on for types 1, 2) | `DiplomacyLocked` (§1) |
| Allow player handicap | `_UI_GamLWind_Label_AllowPlayerHandycap` | checkbox (off); unchecking resets every slot to 100 % (LSP:611-630) | enables the HP column |
| Choose headquarter position | `_UI_PlLiWind_Label_RandomHeadQuater` "Choose headquarter position" | checkbox (off; forced on in Defender) | off → random start positions (§10.4); unchecking renumbers HQs 0.. (LSP:567-588) |
| Game name / password / port | | hidden in skirmish (LSP:118-126) | [MP] |

**Not** in the original setup: start resources (only via Points), start epoch, map size (fixed per map), game speed
(in-game keys), unit limit (map `Population/Max`), random map.

### 10.3 Original — per-slot settings (Players tab; PLW `Slot_0..7`; columns `_UI_PlLiWind_Label_*`: Player name ·
Tribe · Army · Team · Color · HP · HQ · AI Level · GO)
- **Name / type** (PIS:543-563, 645-699, 1006-1072): slot 0 = the human (profile name). Other slots in skirmish: "AI"
  or "Closed" (`_UI_PlLiWind_Option_AI` / `…_Closed`; "Open" only online). New skirmish slots start as AI
  (PIS:755-777). Switching to AI: difficulty **5**, team `(slot index % NumTeams) + 1` (Defender: by HQ), not ready.
- **AI level** 0..9 drop list (PIS:106-119; `Difficulty` slot value). Meaning (AIC:159-187): 0-2 Easy, 3-5 Medium,
  6-9 Hard with think waits 100/75/50/30/25/20/16/14/12/10 (+ difficulty-based cheats, ai.md §3).
- **Army (= AI personality for AI slots)** (PIS:601-642, 973-1004): list from the bit mask `AI/Personalities`
  (1 Defensive, 2 Balanced, 4 Offensive, 8 Passive, ≥ 9 Random): "Random" → `ai_Random`, Defensive →
  `ai_Schnecke`, Balanced → `ai_Giraffe`, Offensive → `ai_Dodo`, Passive → `ai_Mikrobe` (sleeps). Default mask
  [?engine/profile]. [bug] the mask decode treats ≥ 9 as "Random" **and** keeps subtracting, so Random implies
  Passive (PIS:53-58, 609-613). Server: `ai_Random` picks Dodo / Giraffe / Schnecke from the mask bits 4/2/1 —
  **never Mikrobe** (SA:441-453; crash risk if none of those bits is set: modulo 0). For humans the Army list is the
  point-buy presets (§7.2).
- **Tribe** (PIS:383-415): the map's `PlayerSettings/Player_<HQ>/Restrictions/Base/Tribes` (":"-separated) **minus
  SEAS**, plus "Random" when more than one; icons `tribeicon_<tribe>`. Random resolved at Ready by the client
  (PIS:874-891) and on the server via `Tribe2Use` (SA:429-436).
- **Team** 1..NumTeams (PIS:286-342; Defender: fixed by HQ; disabled when ready).
- **Colour** 8 swatches `TeamCol 0..7` (PIS:130-141; = ACColors.txt PlayerColor0..7); must be **unique**
  (PLW:381-402); default [?engine] (`InitColorMap` SA:591).
- **HP / handicap** 50 %..150 % step 10 (PIS:143-151), only with "Allow handicap". Effect [?engine →
  data]: tech-tree filter `/Filters/Special/Upgrades/handicap/handicap_<HP>` (PWServer string) — TT:85416-…
  multiplies `Hitpoints/{tec,nat,res}_rel` of the player's CHTR, BLDG, ANML, VHCL, SHIP for **Hu, Aje, Ninigi,
  Special** — [bug] **no SEAS rows**: SEAS ignores the handicap.
- **HQ** (start position) 1..MaxPlayers (PIS:216-237, 1127-1154), shown only with "Choose HQ"; must be **unique**
  (PLW:404-430); Defender needs someone on HQ 1 (= index 0).
- **GO / Ready** button (PIS:855-945, 1175-1256): sends the point-buy result, AI-assist flags
  (`Game/ControllerOptions/*Support`), locks the row.
- **Start validation** (PLW:334-456): all ready, unique colours, unique HQs, defender present, and with locked
  diplomacy at least 2 teams (except Defender). Offending column header turns red.
- [bug] PLW:181 `bHost==true;` (comparison, no effect). `CSettings Game/RecentSettingsSkirmish/NumPlayers` restores the
  last player count (PLW:261-271).

### 10.4 Original — game start
- **Start positions** (SA:346-398): with "Choose HQ" off on a multiplayer map, every occupied slot gets a **random
  distinct** HQ index out of 0..MaxPlayers−1 (`RandomHQFlag` prevents re-randomising on load); the player id
  (owner) **is** the HQ index (SA:497-500). Start location object = `PlayerSettings/Player_<owner>` SLOC.
- Relations from teams (§1.1); `TTDef` filters per player (SA:527-535); start objects via StartLocation (§7.1).
- AI types → `CAiPlayer(n)` (SA:454-488): Dodo 2, Giraffe 6, Schnecke 10, Mikrobe/closed 14 (the `_easy/_medium/
  _hard` variants 3-5, 7-9, 11-13 are for campaign maps).

### 10.5 Remake
- `ui/menu.js skirmish()` (208-250): your tribe + colour; one computer opponent tribe + colour; difficulty
  easy/normal/hard (→ 1 / 4 / 8, `ai/data.js:10 MENU_LEVELS`); warp-gate victory checkbox; debug mode; map list /
  file / random jungle with seed. SEAS allowed (original excludes it).
- `main.js` (458-494): exactly two players (ids 0, 1); `maps/source.js:275-282` picks the two start locations
  farthest apart; `createBrains` (579-602) one TribeAI (personality random Dodo/Giraffe/Schnecke as `ai_Random`).
- Campaign code already handles N players (`G.brains` map, `W.players`, per-pair relations) — the engine side is
  ready; only the skirmish setup is 1-vs-1. `maps/ula.js:278` reads `maxPlayers`; `md.infoTree` holds
  `PlayerSettings` (tribes, restrictions). Fog: `engine/terrain.js revealAll`. Warp gate:
  `systems/buildings.js:134-142`, `world.rules.warpgateMinutes`.

### 10.6 Plan
1. **Config model** (`settings.skirmish`): `{ map, seed, mode: 'deathmatch'|'domination'|'defender', defenderMin,
   points: -1|1000|3000|10000, warpgate, fog, lockDiplomacy, handicap, chooseHQ, teams, slots: [{ type: 'human'|'ai'|
   'closed', tribe|'Random', personality: 'Random'|'Dodo'|'Giraffe'|'Schnecke'|'Mikrobe', level: 0..9, team, color,
   hp: 50..150, hq, army(preset) }] }` — up to `map.maxPlayers` (random jungle: generator decides, e.g. 2–4).
   Migrate old `{me, ai, aiLevel, …}` settings.
2. **Menu** (`ui/menu.js skirmish()` → split into `ui/skirmish.js`): left = map/game-info panel (existing picker +
   §10.2 options), right = 8 slot rows like PlayerListWindow.srf (name/type, tribe icon select, army/personality,
   team, colour swatches, HP, HQ, AI level). Validation as PLW:334-456 (red header). Tribes from the map's
   `Restrictions/Base/Tribes` (decide whether to keep SEAS — §11).
3. **Game start** (`main.js`): loop over slots → `new Player(id = HQ index, …, {team, color, ai})`; start positions:
   map SLOCs by HQ (`PlayerSettings/Player_<hq>` start location); random distinct HQs when not chosen;
   relations from teams; handicap = multiply `maxHp` of the player's entities (data: TT handicap filters → build
   `handicap` factors; apply to SEAS too or not — §11); `debug` stays a human option.
4. **Brains**: `createBrains` → for each AI slot `new TribeAI(G, p, { difficulty: level, behaviour: resolve(personality),
   multimap: true, mapOptions })` (object form of brain.js:36-52); `Random` = Dodo/Giraffe/Schnecke. Remove the
   legacy (enemy) constructor use; `G.ai` → first AI for old callers (`main.js:891, 1144, 1178`, `save.js:190`).
5. **Modes**: port §9 to `src/game/systems/gameover.js` (replaces `main.js checkEnd`): unit/production-building
   death, HQ timer 5 min (`LastManStanding` map flag), warp gate (existing), domination flags (`DOFL` objects are
   currently dropped as props in `maps/source.js:95` — keep them as capturable objects; `Shell.usl:84-90`
   `ChangeDominationOwner`; flag capture rules need a separate study [?]), defender (defender timer, `defender_object`).
   HUD timers like the original TimerWnd (icons headquater / warpgate / domination / defender).
6. **Options**: fog off → `G.fow.revealAll = true`; warp gate off → hide `*_warpgate` build actions
   (`warpgate_invisible` filter); lock diplomacy → `W.rules.diplomacyLocked`.
7. Tests: extend `remake/tests` with a 4-player skirmish smoke test (2v2 teams, AI vs AI) and a domination/defender
   map if the installation has one.

---------------------------------------------------------------------------------------------------------------

## 11. Decisions for the user (before implementation)

**Answered (user, 2026-10-16): the defaults below, except credits - skip them.** So: multiplayer-only parts dropped;
victory by teams; SEAS allowed in skirmish; no replays; the "Keep playing" button kept; point-buy default 1000 and the
campaign army screen built with it; real skull statistics; no credits; "AI<n>:" requests in "To All" chat only;
Domination and Defender included.


1. **Scope of "multiplayer-only" parts** — no network play in the remake, so: whisper, human chat targets, lobby chat,
   tribute *requests* to humans, game name/password/port, Ready/countdown, Save Replay — **drop** (recommended) or keep
   stubs for a future network mode?
2. **Diplomacy & victory**: faithful (victory by slot teams; in-game alliances don't share victory except via warp
   gate) or "allied victory" by current relations (what the remake's checkEnd does today)?
3. **AI requests in chat**: original only in "To All" mode — keep or accept "AI<n>:" in any mode?
4. **End screen**: drop the remake's "Keep playing" (original has none) or keep it as an extra?
5. **Point buy default**: original default 1000 points (players buy their army), remake today = Predefined.
   Which default, and should the campaign army screen (PB missions) be built in the same step?
6. **SEAS in skirmish**: the base game excludes SEAS from the tribe list and has no SEAS presets / handicap rows;
   the remake currently allows SEAS. Keep allowing it (needs invented `_pb_locked` and handicap for SEAS) or
   follow the original?
7. **Statistics fidelity**: Skulls column is 0 in the original (sampling commented out); Overview formulas are
   engine-side — reproduce the zero or show real values; accept approximated Overview?
8. **Replays**: skip (original hides it behind a developer flag) or build a deterministic command replay (large;
   needs a seeded RNG through the whole simulation)?
9. **Credits**: film only (needs `credits.bik` from the user's installation), or film + remake credits page?
10. **Domination flags** need their own short study (capture rules in `DominationFlag` class [?]); include game modes
    in this step or deathmatch-only first?

## 12. Original defects / dead code collected here
- DW:90-100 digit filter checks only the last character. DW:116-119 request sends unlocalised resource id.
  `_NT_DiplTributeRequestSent` unused.
- SA:814-819 receiver storage cap disabled for tributes. STM `scalps` vs UI never sending iron → `TRIB` on skulls
  unreachable.
- AIC:616-618 identical consecutive AI requests ignored; AIC:746-764 `GetWantedAi` uninitialised for unknown targets.
- CW: AI requests only in "To All"; `/who` prints a literal stub; `CIngameChatOutput` never instantiated; chat
  prefix colouring commented out.
- ES: skirmish branches dead (server always sends "Multiplayer"); skirmish loses "Load Game"; no continue option.
- SS: `Collected_Skulls` sampling commented out (FO:3967); unused option/tab keys.
- GOM:9-13 `CHECK_DEFENDEROBJS = 016h` overlaps other bits; GOM:727-732 domination "most owner" never updates the
  maximum; GOM:868 defender hard-coded to owner 0.
- LSP:85 vs 511 defender timer defaults 45 vs 10. PLW:181 `bHost==true;`. PIS:53-58 / 609-613 personality mask
  decode (Random ⇒ Passive). SA:441-453 `ai_Random` never Mikrobe, modulo-0 when no bit set.
- TT handicap filters lack SEAS. PBM:287-294 vs SL:625-630 rounding (ceil per click vs truncation of the total).
  `PointBuyCosts.txt` loaded but unused (SL:413-417).

## 13. What the remake does (2026-10-16)

The plans of §1-§10 with the decisions of §11 (multiplayer-only parts dropped, victory by teams, SEAS allowed, no
replays, "Keep playing" kept, point buy 1000 by default with the campaign army screen, real skull statistics, no
credits, "AI<n>:" in "To All" lines only, Domination and Defender included):

| group | remake | notes / deviations |
|---|---|---|
| 9 skirmish setup | `ui/skirmish.js`, `game/skirmish.js`, `main.js skirmishPlayers / createBrains / quickConfig` | map list filtered by game type (`maps/index.json` players / modes / type; campaign maps only by "Open map file"); the random jungle: deathmatch, up to 4 players (`mapgen.js setPlayers`); the setup kept in `settings.skirmishSetup` |
| 9 game types | `game/systems/gameover.js`, HUD timers | §9; neutral map objects (no owner) of skirmish maps are not placed yet |
| 8a point buy | `game/pointbuy.js`, `ui/pointbuy.js`, `menu.js campaignArmy` | docs/spec/pointbuy.md §11 |
| 8b credits | – | skipped (user decision) |
| 7a diplomacy | `ui/diplomacy.js`, `scripting.js changeOpinion / attackAllowed` | the top bar's button in skirmish games only; locked with the option, in Domination and Defender |
| 7b tribute | `scripting.js tribute`, the diplomacy rows | Request asks a computer player (100, `ai/chat.js`); no human players to ask |
| 7c chat | `ui/chat.js`, `input.js` (Enter / Ctrl+Enter / Shift+Enter) | whisper and `/who` dropped; the chat button's right click: the history of every message line |
| 7d statistics | `game/stats.js` (World.emit, saved), `ui/stats.js` | skulls counted (the original's sample is commented out); Overview = the sums of the other tabs [?engine]; time line every 10 s |
| 7e end screen | `menu.js end` | Retry / Continue, Load Game, View Statistics, (Keep playing: skirmish), Back to Main menu, Quit; the game pauses; caption Skirmish / Campaign |
| 7f replays | – | not done (user decision) |

