# Mission UI (`src/ui/mission.js`)

What the player sees of a campaign mission besides the ordinary HUD: quest log and news ticker, dialogue scenes,
cutscenes, timers, the info bar, minimap markers, question marks, the title card and the end screen. The **trigger
engine** owns the state and calls this class through the contract in the header of `src/ui/mission.js`
(`G.mission`, created in `main.js` for missions only); this file describes what each call shows, what the UI reads
from `G.campaign`, and what it offers beyond the contract. Behaviour of the original: `docs/spec/triggers.md` §5.2, §6.

Test: `python3 tests/evaljs.py tests/mission_ui.js "&campaign=1"` (in `tests/regress.sh`), speech:
`tests/mission_audio.js`, screenshots: `python3 tests/mission_shots.py <dir> [mission] [port]`.

## 1. Where things are on the screen

| element | place | original |
|---|---|---|
| **Quests** button | top right, left of *Menu* (`hud/menu_questbutton.tga`); flashes after a quest change until the log is opened | `IngameScreen.usl:309-326`, `QuestWindow.usl:509-523` |
| news ticker, dialogue box | left column under the resource bar, down to the minimap (272 px × interface size) | `NewsTicker.usl` (a 235 px column); the original shows dialogue lines *through* the ticker (`DialogScene.usl:35`) |
| info bar, timers | top centre under the top row; the HUD's own messages move below them | `IngameScreen.usl:281, 384`, `TimerWnd.usl` |
| quest log | a menu window (`G.menu.open`): modal, pauses the game, Esc / L / Close | `QuestWindow.usl` (765 × 515, `CGameWrap.Pause`) |
| cutscene | full screen, above the HUD and below the menus (z-index 55): letterbox bars, subtitles | engine |
| title card | upper third: mission title + description for 7 s, fades (earlier when a dialogue line shows); not with `?manual` | - |
| question marks, marker rings | in the world | `QuestionMark.usl`, `MiniMap2.usl` |

Everything follows the interface size (`G.hud.s`) and the window size (`layout()`), the ticker drops its oldest
lines when the column would reach the minimap.

## 2. The calls of the contract

* **`questChanged(quest, change)`** - `shown` / `done` / `failed`: a ticker line (`_NT_QuestNew`,
  `_NT_QuestAccomplished`, `_NT_QuestUnaccomplishable` + headline, icons `nticon_quest_*`) and the sound
  `ui_quest_new` / `ui_quest_accomplished` / `ui_quest_unaccomplishable`; the button flashes. `hidden`: nothing
  (the log simply no longer lists it). A click on the line opens the log at that quest, a right click removes it.
  The log lists the visible quests of `G.campaign.data.quests` as the original: the groups of the main quests
  (`group_title`) in order of appearance with points got / possible, main quests without a group, the side quests
  under `_SubQuestGroup`; colours of `QuestWindow.usl:66-70` (new yellow, open grey-brown, accomplished green,
  failed red and crossed out); right: headline, state, `description`, points. **The engine must set the flags
  (`visible`, `accomplished`, `unaccomplishable`) before the call.** Points = `quest.bonus[easy|medium|hard]` of
  `G.campaign.difficulty`.
* **`infoBar(text)`** - one line, top centre; `''` removes it.
* **timers** - every frame the entries of `G.campaign.timers` with a truthy `show`: a pill (`hud/timers.tga`) with
  `left` as `mm:ss` (`h:mm:ss`) and `label` under it; red in the last 10 s, dimmed while `paused`. A timer that
  leaves the map leaves the screen.
* **`marker(m)` / `removeMarker(id)`** - drawn in the minimap (`Minimap.update` calls `drawMinimap`) as a dot with a
  ring running outwards; colour by `kind` as `MiniMap2.usl:238-262` (`Attack` 255,0,0 · `SPMainQuest` 255,200,100 ·
  `SPOptQuest` 200,200,200 · `SPHint` 0,120,0), `FixedColor` (or an unknown kind) = `m.color`. `entity`: follows it
  (game time). `ttl > 0`: lit for `ttl` seconds, then `repeats` more times with `interval` seconds of darkness
  between, then gone; `ttl = 0`: until removed. `extended`: also a pulsing ring on the ground in the world.
* **`playDialog(scene, onEnd)`** - queued; one scene at a time on game time. Per frame: portrait (the actor's `icon`,
  else its `class`, from the game's card atlas; a framed initial if there is none), `speaker` + `:` and the text,
  the sound `ui_message`. Length: the frame's sound, at least 0.25 s per vowel group (`DialogScene.usl:419-465`);
  **without the sound file** the spoken length is estimated from the text (`0.6 s + 0.065 s per letter`, at least 1.5 s; this fits the game's voice files) so that the
  mission keeps its pace and the line can be read. With sound the frame ends when the sound has ended. The × on
  the box closes the scene (`OnClose`): `onEnd` is called. Mentor scenes (`scene.mentor`): blue frame; with the
  option "Show the mentor's hints" off (`G.settings.mentor === false`) they are not shown and last 0.5 s per frame,
  except on a tutorial map (`map.tutorial`). An unknown scene (`null`, no frames) ends on the next tick.
  Sound and music are turned down to 50 % while scenes play.
* **`playSequence(seq, opts, onEnd)`** - queued; the UI pauses the game (`G.setPaused(true)`, no "Paused" label),
  hides the HUD, shows the bars and the `lines` one after another (speaker = `_ds_ACTOR_<Name>` or the capitalised
  id, portrait if the atlas has one), `opts.title` in the upper bar. The camera eases to `opts.camera` in 1.6 s.
  A line stays for its speech file's length + 0.4 s, else for a reading time (`max(2.4 s, 1.2 s + 0.062 s per
  letter)`); click / Space / Enter = next line, Esc = end of the scene; every other key is swallowed, no
  scrolling, no quest log. F10 opens the menu (the scene waits). At the end: camera back to where it was
  (`opts.snapBack`) or left at `opts.camera`, pause state restored, `onEnd` once. A sequence without lines (or
  `null`) ends at once; with `?manual` every sequence ends on the next `tick` without being shown. The fog is
  refreshed when a scene starts (`G.updateFow`), so what the engine reveals for it is seen although the game
  stands still. `busy()` is true from the request to the end of the last queued sequence.
* **`skipAll()`** ends everything in the order it was asked for. **`log`**: `['quest', name, change]`, `['news',
  text, kind]`, `['infobar', text]`, `['marker', id, kind]`, `['unmarker', id]`, `['questionmark', name, state]`,
  `['dialog', id]`, `['frame', id, i]`, `['dialogEnd', id]`, `['sequence', id]`, `['line', id, i]`,
  `['sequenceEnd', id]`, `['title', text]`.

Nothing is ended inside `playDialog` / `playSequence`: scenes start and end in `tick` (dialogues, game time) and in
`tick` or `update` (cutscenes), so an `onEnd` never runs inside the engine's own action.

## 3. Read from `G.campaign` without a call

* `questionMarks` + the `questionmark` event: a floating `?` (red, green, yellow) or yellow `!` over the mark's
  place (a sprite drawn in code: the original models are not in the built assets); hidden where the player has
  not explored; the mouse over it shows `text(mark.tooltip)` in the HUD's tooltip.
* `timers` (above), `data.quests`, `data.texts`, `map.title` / `map.description` (title card, end screen),
  `map.tutorial`, `difficulty`.

## 4. Beyond the contract

`openLog(questGuid?)`, `closeLog()`, `toggleLog()` · `news(text, kind, { icon, sound, quest, html, time })` (any
ticker line; kinds `new` / `good` / `bad`) · `showTitle()` · `closeDialog()` · `next()`, `skip()` (cutscene) ·
`key(e)` (hook of `ui/input.js`: true = used up) · `drawMinimap(ctx, minimap)` · `frameLength(text, soundSeconds)` ·
`frameSound(scene, frame)`, `lineSound(seq, line)` · fields `manual`, `cine`, `scene`, `markers`, `queue`.

`G.endMission(won, { text, delay, points })`: the end screen shows the game's result line (`_GAOV_Accomplished` /
`_GAOV_Failed`), the mission title, `text` (the reason of a defeat, red), the visible quests with their result and
"Bonus points: `points`" (without `points`: the sum of the accomplished quests "of" the possible).

Keys: **L** quest log (the original has only the button). Options: "Show the mentor's hints in campaign missions".

## 5. Hooks in other files

* `src/main.js`: `G.updateFow()`; `G.endMission` passes `info.points`; the start message is left to the title card.
* `src/ui/overlay.js` `Minimap.update`: `G.mission.drawMinimap(ctx, this)` before the camera frame; redraw every
  0.08 s instead of 0.25 s while markers exist.
* `src/ui/input.js`: `onKey` asks `G.mission.key(e)` first; `update` does nothing while `G.mission.cine`.
* `src/ui/menu.js`: `end()` for missions, the option `mentor`, the Controls line for L.
* `index.src.html`: the CSS block "campaign: mission UI".
* `toolkit/remake.py`: `assets/SeqSounds/<path>` → `Data/<mod>/Audio/SeqSounds/<path>`.

The quest button, the left column and the top stack are created by `MissionUI.build()` inside the HUD's root (so
the HUD's own click shield covers them) - `hud.js` is untouched.

## 6. Speech

The original plays a frame's `audio` as a sound event of `Scripts/Server/init/dialogsounds.txt`
(`ds_1020_Cole_01` → `'../SeqSounds/Level_1/1020_Cole_01.mp3'`, relative to `Audio/Sound`; mentor hints
`'../SeqSounds/Mentor/L01B01.mp3'`). The UI takes the file from `sounds.json` if the event is there, else builds
the same path by that rule (`Level_<mission>` / `0_Tut_Level` / `Mentor`), and plays it through `G.audio`
(`buffer` + `playFile`, voice channel). The browser asks for `assets/snd/../SeqSounds/…` = `assets/SeqSounds/…`,
which `toolkit/remake.py` serves from `Data/<mod>/Audio/SeqSounds/`. Cutscene lines: the sequence's `speech[]`
entry whose file name is the line's key (`_seq_1040_stina_01` → `…/SeqSounds/Level_1/1040/1040_Stina_01.mp3`, the
`.lsd` next to it is lip data). A missing file, a muted game or a browser that has not been clicked yet: silence
and the text timing. Films (`videos[]`, `.bik`) are not played: browsers cannot play Bink.
