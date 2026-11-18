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
