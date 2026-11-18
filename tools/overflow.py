# Opens every category, tab and hover state, and reports any element whose content is clipped or
# whose text sticks out of its box or its parent card.
from playwright.sync_api import sync_playwright
CHECK = """() => {
  const out = [];
  const els = document.querySelectorAll('#bar *, #tray *, #status, #help *, #game-chip, #game-chip *, #game-panel, #game-panel *, .game-dialog, .game-dialog *');
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || el.offsetParent === null) continue;
    const label = (el.className || el.tagName) + ' "' + (el.textContent || '').trim().slice(0, 24) + '"';
    // a text cut with an ellipsis on purpose (a long game name) is clipped by design; it is checked by size elsewhere
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.textOverflow !== 'ellipsis' && el.tagName !== 'INPUT') out.push('clipped x: ' + label + ` ${el.scrollWidth}>${el.clientWidth}`);
    if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'auto' && el.tagName !== 'IMG') out.push('clipped y: ' + label + ` ${el.scrollHeight}>${el.clientHeight}`);
    // text nodes poking outside their own element
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      const t = r.getBoundingClientRect(), b = el.getBoundingClientRect();
      if ((cs.textOverflow !== 'ellipsis' && (t.right > b.right + 1 || t.left < b.left - 1)) || t.bottom > b.bottom + 1) out.push('text outside: ' + label);
    }
  }
  // the game chip, panel and dialogs must lie fully on screen
  for (const el of document.querySelectorAll('#game-chip, #game-panel, .game-dialog')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect(); if (r.width === 0) continue;
    if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) out.push((el.id || el.className) + ' off screen');
  }
  for (const id of ['bar', 'tray']) {   // containers themselves: nothing may stick out of them
    const box = document.getElementById(id); if (!box || !box.offsetParent) continue;
    const b = box.getBoundingClientRect();
    if (b.left < 0 || b.right > innerWidth) out.push(id + ' off screen');
    for (const el of box.querySelectorAll('*')) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      const inScroller = (() => { for (let p = el.parentElement; p && p !== box; p = p.parentElement) { const c = getComputedStyle(p); if (c.overflowX === 'auto' || c.overflowX === 'scroll') return true; } return false; })();
      if (!inScroller && (r.right > b.right + 0.5 || r.left < b.left - 0.5)) out.push(id + ' child sticks out: ' + el.className);
    }
  }
  // General rule: every visible text must lie fully inside every ancestor that clips (overflow not visible)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || !n.parentElement.offsetParent) continue;
    if (!n.parentElement.closest('#bar, #tray, #status, #help, #game-chip, #game-panel, .game-dialog')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    // text cut with an ellipsis shows only what is inside its own box
    let cut = null; for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).textOverflow === 'ellipsis') { cut = a.getBoundingClientRect(); break; }
    for (const raw of r.getClientRects()) {
      const t = cut ? { left: Math.max(raw.left, cut.left), right: Math.min(raw.right, cut.right), top: raw.top, bottom: raw.bottom } : raw;
      for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        if (cs.textOverflow === 'ellipsis') continue; // cut with an ellipsis on purpose
        const b = a.getBoundingClientRect();
        const scrollsX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const scrollsY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        const outY = !scrollsY && (t.bottom > b.bottom + 0.5 || t.top < b.top - 0.5);
        const outX = !scrollsX && (t.right > b.right + 0.5 || t.left < b.left - 0.5);
        // in a sideways-scrolling row, text must still fit vertically (and vice versa)
        const crossOut = (scrollsX && (t.bottom > b.bottom + 0.5 || t.top < b.top - 0.5)) || (scrollsY && (t.right > b.right + 0.5 || t.left < b.left - 0.5));
        if (outY || outX || crossOut) {
          out.push('text clipped by ' + (a.id || a.className) + ': "' + n.textContent.trim().slice(0, 24) + '"');
          break;
        }
      }
    }
  }
  return [...new Set(out)];
}"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    problems = {}
    for width in (1280, 1024, 900, 700, 390, 360):
        pg = b.new_page(viewport={"width": width, "height": 800})
        pg.goto("http://localhost:4173/"); pg.wait_for_timeout(1800)
        def check(where):
            for msg in pg.evaluate(CHECK): problems.setdefault(msg, []).append(f"{width}px {where}")
        check("closed")
        for cat in pg.locator(".category:not(.tool-button)").all_inner_texts():
            pg.click(f".category:has-text('{cat}')")
            for t in pg.locator(".tab").all_inner_texts():
                pg.click(f".tab:has-text('{t}')")
                check(f"{cat}/{t}")
                for i in range(pg.locator(".item-card").count()):
                    card = pg.locator(".item-card").nth(i)
                    card.hover(); pg.wait_for_timeout(30); check(f"{cat}/{t} hover#{i}")
            pg.click(f".category:has-text('{cat}')")
        pg.click(".tool-button"); check("bulldoze"); pg.click(".tool-button")
        pg.click(".help-toggle"); check("help"); pg.click(".help-toggle")
        pg.close()
    for msg, where in problems.items(): print(msg, "| e.g.", where[0], f"({len(where)} states)")
    print("PROBLEMS:", len(problems))
    b.close()
