# Fast UI check: every width in parallel, one hovered card per tab, and every chip text measured by
# writing it straight into the chip (no clicking through 66 items).
import os, re, sys, time
from multiprocessing import Pool
from playwright.sync_api import sync_playwright

URL = "http://localhost:4173/"
CHECK = re.search(r'CHECK = """(.*?)"""', open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overflow.py')).read(), re.S).group(1)
WIDTHS = [int(w) for w in sys.argv[1:]] or [1280, 1101, 1024, 900, 700, 390, 360]

# Every title/detail pair the chip can show, measured in the real chip at this width
CHIP = """(names) => {
  const text = document.querySelector('.tool-text'); const bad = [];
  const title = text.querySelector('b'), detail = text.querySelector('span'), filters = text.querySelector('.bulldoze-filters');
  const saved = [title.textContent, detail.textContent, filters ? filters.hidden : true];
  const details = ['click to pick up', 'click an item', 'Moving · click to drop', 'Copied · Ctrl+V to paste', 'Pasting · click to place', 'Moving · click a wall',
    'Del to remove', 'drag to paint', 'click a wall', 'drag along a wall', 'Line · drag along grid lines',
    'Room · drag a rectangle', 'Room · 32x32', '32 segments', 'drag along a bank', 'click or drag along walls', 'paints the hidden side', 'Fill all · 4096 tiles', 'click or drag a box', 'Box · 4096 things', '4096 selected', 'click to move', '4096 things', 'Moving · click to drop', 'Fill all · 999 sides', 'Shift: point at a wall', 'Shift: not in a room', '2x2', ...names.map(n => 'copy ' + n)];
  // Bulldoze texts are measured with the filter row showing, as they appear in use
  const bulldoze = ['drag a box · Shift room', 'Shift: not in a room', 'Room · 999 to remove', '64x64 · 999 to remove'];
  const titles = ['Select', 'Picker', 'Bulldoze', ...names];
  const fits = (el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
  const inside = (el) => { const a = el.getBoundingClientRect(), b = text.getBoundingClientRect(); return a.right <= b.right + 0.5 && a.left >= b.left - 0.5; };
  if (filters) filters.hidden = true;
  for (const t of titles) { title.textContent = t; detail.textContent = details[0]; if (!fits(title)) bad.push('title: ' + t); }
  for (const d of details) { title.textContent = 'Select'; detail.textContent = d; if (!fits(detail) || !fits(text)) bad.push('detail: ' + d); }
  if (filters) {
    filters.hidden = false;
    for (const d of bulldoze) {
      title.textContent = 'Bulldoze'; detail.textContent = d;
      if (!fits(detail) || !fits(text)) bad.push('bulldoze detail: ' + d);
      if (![...filters.children].every(inside) || !inside(filters)) bad.push('bulldoze filters stick out with: ' + d);
    }
  } else bad.push('no bulldoze filter row found');
  [title.textContent, detail.textContent] = saved; if (filters) filters.hidden = saved[2];
  return bad;
}"""

# What the general sweep cannot say about the game chip, panel and dialogs: they stay on screen, the
# chip's name keeps to its width (an ellipsis is fine, a spill is not), and nothing lies on top of the chip
GAME = """() => {
  const bad = [], q = (s) => document.querySelector(s), rect = (e) => e.getBoundingClientRect();
  const chip = q('#game-chip'), name = q('.game-name'), narrow = innerWidth <= 420;
  const c = rect(chip);
  if (c.left < 0 || c.right > innerWidth + 0.5) bad.push('game chip off screen');
  if (name.getBoundingClientRect().width > (narrow ? 140 : 220) + 1) bad.push('game name wider than its limit');
  if (narrow && getComputedStyle(q('.game-state')).display !== 'none') bad.push('state text shows on a narrow phone');
  if (narrow && getComputedStyle(q('.game-dot')).display === 'none') bad.push('no dot on a narrow phone');
  const status = q('#status'); if (status && rect(status).top < c.bottom - 0.5) bad.push('status is not below the chip');
  const panel = q('#game-panel');
  if (panel && !panel.hidden) {
    const p = rect(panel);
    if (p.top < c.bottom - 0.5) bad.push('panel overlaps the chip');
    if (p.right > innerWidth + 0.5 || p.left < 0 || p.bottom > innerHeight + 0.5) bad.push('panel off screen');
    const list = q('.game-list'); if (list && rect(list).height > 330) bad.push('list taller than about six rows');
    for (const e of panel.querySelectorAll('button, select, input')) { const r = rect(e); if (r.width && (r.right > p.right + 0.5 || r.left < p.left - 0.5)) bad.push('panel control sticks out: ' + (e.className || e.tagName)); }
  }
  for (const d of document.querySelectorAll('.game-dialog')) {
    const r = rect(d);
    for (const e of d.querySelectorAll('button, input, h2, p, .game-shape, .game-error')) { const x = rect(e); if (x.width && (x.right > r.right + 0.5 || x.left < r.left - 0.5)) bad.push('dialog item sticks out: ' + (e.className || e.tagName)); }
  }
  return bad;
}"""

def game_sweep(b, width):
    """Opens the game chip, panel and dialogs in the states a player can reach, with a long name."""
    problems, states = [], 0
    pg = b.new_page(viewport={"width": width, "height": 800}); pg.goto(URL); pg.wait_for_timeout(1500)
    def check(where):
        nonlocal states; states += 1
        problems.extend(f"{m}  [game: {where}]" for m in pg.evaluate(CHECK) + pg.evaluate(GAME))
    long_name = "W" * 40
    check("chip")
    pg.click("#game-chip"); check("panel, no saves")
    pg.click(".game-action:has-text('Save as')"); check("save as row")
    pg.fill(".game-saveas .game-input", long_name); pg.keyboard.press("Enter"); pg.wait_for_timeout(100); check("long name, saved")
    for i in range(7):   # more than six rows, so the list scrolls
        pg.click(".game-action:has-text('Save as')"); pg.fill(".game-saveas .game-input", f"Town number {i} " + "m" * 30); pg.keyboard.press("Enter")
    pg.wait_for_timeout(100); check("panel, 8 saves")
    pg.locator(".game-icon[aria-label^='Rename']").first.click(); check("rename in place"); pg.keyboard.press("Escape")
    pg.locator(".game-icon.remove").last.click(); check("delete armed")
    pg.click(".game-action:has-text('New game')"); check("new game")
    pg.fill(".game-dialog .game-number >> nth=0", ""); check("new game, empty width")
    pg.fill(".game-dialog .game-number >> nth=0", "300"); check("new game, width too big")
    pg.click(".game-squares .game-action:has-text('256')"); pg.fill(".game-dialog .game-number >> nth=1", "16"); check("new game, 256 by 16")
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape"); check("closed again")
    # something unsaved: build one object, so the chip warns and New game asks first
    pg.click(".category:has-text('Scenery')"); pg.locator(".item").first.click(); pg.mouse.click(width // 2, 380); pg.wait_for_timeout(100)
    check("unsaved changes")
    pg.click("#game-chip"); pg.click(".game-action:has-text('New game')"); pg.click(".game-dialog .game-primary:has-text('Start')"); pg.wait_for_timeout(100)
    check("save first prompt")
    pg.evaluate("() => { Storage.prototype.setItem = () => { throw new Error('quota') } }")
    pg.click(".game-dialog.prompt .game-primary"); pg.wait_for_timeout(100); check("prompt, storage full")
    pg.keyboard.press("Escape"); pg.keyboard.press("Escape"); pg.keyboard.press("Escape"); check("chip, storage full")
    pg.close()
    # a game with pieces the catalog no longer knows: the chip says how many were left out
    pg2 = b.new_page(viewport={"width": width, "height": 800}); pg2.goto(URL); pg2.wait_for_timeout(800)
    pg2.evaluate("""() => {
      const bad = { defId: 'gone', x: 1, y: 1, w: 1, h: 1, rotation: 0, id: 1 };
      localStorage.setItem('iso-sandbox:saves', JSON.stringify({ version: 1, saves: [{ id: 1, name: 'Old town', w: 64, h: 64, savedAt: Date.now() }] }));
      localStorage.setItem('iso-sandbox:save:1', JSON.stringify({ version: 1, w: 64, h: 64, rotation: 0, nextId: 1, objects: [bad, bad, bad], walls: [], culverts: [], tiles: { palette: [], runs: [] } }));
    }""")
    pg2.reload(); pg2.wait_for_timeout(1200)
    if "Loaded, 3 pieces left out" not in pg2.text_content("#game-chip"): problems.append(f"no notice after loading a save with pieces left out [game: notice] got {pg2.text_content('#game-chip')!r}")
    problems.extend(f"{m}  [game: notice]" for m in pg2.evaluate(CHECK) + pg2.evaluate(GAME)); states += 1
    pg2.close()
    return problems, states

def check_width(width):
    problems, names, states = [], set(), 0
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        pg = b.new_page(viewport={"width": width, "height": 800}); pg.goto(URL); pg.wait_for_timeout(1500)
        def check(where):
            nonlocal states; states += 1
            problems.extend(f"{m}  [{where}]" for m in pg.evaluate(CHECK))
        check("closed")
        for cat in pg.locator(".category:not(.tool-button)").all_inner_texts():
            pg.keyboard.press("v"); pg.click(f".category:has-text('{cat}')")
            for t in pg.locator(".tab").all_inner_texts():
                pg.click(f".tab:has-text('{t}')")
                # catalog names become chip titles; the blueprint tray's labels do not (a placed
                # blueprint's own name, typed by the player, is cut with an ellipsis in the chip)
                if 'Blueprints' not in cat: names.update(pg.locator(".item .name").all_inner_texts())
                check(f"{cat}/{t}")
                pg.locator(".item-card").first.hover(); check(f"{cat}/{t} hover")
        pg.keyboard.press("v"); pg.click(".tool-button:has-text('Bulldoze')"); check("bulldoze")
        pg.click(".help-toggle"); check("help")
        problems.extend(f"chip {m}" for m in pg.evaluate(CHIP, sorted(names)))
        pg.close()  # one busy page per width at a time: the software renderer is slow enough already
        more, n = game_sweep(b, width); problems.extend(more); states += n
        b.close()
    return width, states, len(names), sorted(set(problems))

if __name__ == "__main__":
    start = time.time()
    with Pool(len(WIDTHS)) as pool:
        results = pool.map(check_width, WIDTHS)
    total = 0
    for width, states, n, probs in results:
        total += len(probs)
        print(f"{width}px: {states} states, {n} item names, {'no problems' if not probs else str(len(probs)) + ' problems'}")
        for m in probs[:20]: print("   ", m)
    print(f"UI PROBLEMS: {total}  ({time.time() - start:.0f}s)")
    sys.exit(1 if total else 0)
