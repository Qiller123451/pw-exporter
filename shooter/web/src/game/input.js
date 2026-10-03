// Keyboard and mouse. The mouse is captured (pointer lock) while playing; Esc releases it and pauses.
//
//   input.down('KeyW')       is the key held?            input.hit('KeyQ')    was it pressed since the last frame?
//   input.mouse(0)           is the button held?         input.click(2)       was it pressed since the last frame?
//   input.dx / input.dy      mouse movement since the last frame (pixels)     input.wheel   wheel steps
// endFrame() clears the "since the last frame" values. Tests drive the same object: press(), release(), move().
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set();
    this.buttons = new Set(); this.clicked = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;
    addEventListener('keydown', (e) => {
      // while playing no key does what it does in a browser (find, save, the menu bar on Alt ...); the browser's own
      // tab shortcuts (Ctrl+W, Ctrl+T, Ctrl+N) cannot be switched off by a page - main.js asks before leaving
      if (this.locked || e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.press(e.code);
    });
    addEventListener('keyup', (e) => { if (this.locked) e.preventDefault(); this.release(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      if (this.locked) { this.buttons.add(e.button); this.clicked.add(e.button); } else if (this.wantLock) this.lock();     // click to capture the mouse again
      e.preventDefault();
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (this.locked) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; } });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.buttons.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  lock() {
    this.wantLock = true;
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
  }
  unlock() { this.wantLock = false; if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  mouse(b) { return this.buttons.has(b); }
  click(b) { return this.clicked.has(b); }
  endFrame() { this.pressed.clear(); this.clicked.clear(); this.dx = this.dy = this.wheel = 0; }
  // the same entry points for tests / scripted play
  press(code) { this.keys.add(code); this.pressed.add(code); }
  release(code) { this.keys.delete(code); }
  mouseDown(b) { this.buttons.add(b); this.clicked.add(b); }
  mouseUp(b) { this.buttons.delete(b); }
  move(dx, dy) { this.dx += dx; this.dy += dy; }
}
