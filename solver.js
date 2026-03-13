// ===========================================
// EMAKTAB TEST SOLVER - v2.0 (Fixed)
// https://raw.githubusercontent.com/muhammadiso-00/emaktab-solver/main/solver.js
//
// INJECT METHOD (paste in console):
//
//   window.__EMAKTAB_CONFIG__ = {
//     GEMINI_API_KEY: 'YOUR_KEY_HERE',
//     AUTO_SELECT: true,
//     SHOW_REASONING: false,
//   };
//   fetch('https://raw.githubusercontent.com/muhammadiso-00/emaktab-solver/main/solver.js')
//     .then(r=>r.text()).then(eval);
//
// OR just run without pre-setting config — a setup form will appear.
// ===========================================

(function () {
  'use strict';

  // ── CONFIG BOOTSTRAP ──────────────────────────────────────────────────────
  // If the user pre-set window.__EMAKTAB_CONFIG__ before eval, use it directly.
  // Otherwise show a small inline form (no prompt/confirm — they are blocked
  // by Chrome when called inside cross-origin eval).

  const PRE = window.__EMAKTAB_CONFIG__ || {};

  if (PRE.GEMINI_API_KEY) {
    // Pre-configured — start immediately.
    boot({
      GEMINI_API_KEY: PRE.GEMINI_API_KEY,
      MODEL:          PRE.MODEL          || 'gemini-2.5-pro-preview-05-06',
      HIGHLIGHT_COLOR:'#ffeb3b',
      SELECTED_COLOR: '#4caf50',
      AUTO_SELECT:    PRE.AUTO_SELECT    !== undefined ? PRE.AUTO_SELECT    : true,
      SHOW_REASONING: PRE.SHOW_REASONING !== undefined ? PRE.SHOW_REASONING : false,
    });
  } else {
    // Show a tiny setup form so the user can enter their key.
    showSetupForm();
  }

  function showSetupForm() {
    // Remove any stale form
    document.getElementById('emaktab-setup')?.remove();

    const form = document.createElement('div');
    form.id = 'emaktab-setup';
    form.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#fff;border:2px solid #2196F3;border-radius:12px;
      padding:24px;z-index:9999999;font-family:Arial,sans-serif;
      box-shadow:0 8px 32px rgba(0,0,0,.25);width:320px;color:#333;`;
    form.innerHTML = `
      <h3 style="margin:0 0 16px;color:#2196F3;font-size:15px;">Emaktab Solver — Setup</h3>
      <label style="font-size:12px;color:#666;">Gemini API Key</label><br>
      <input id="es-key" type="password" placeholder="AIza…"
        style="width:100%;box-sizing:border-box;padding:7px 10px;margin:4px 0 12px;
               border:1px solid #ccc;border-radius:6px;font-size:13px;"><br>
      <label style="font-size:12px;color:#666;">Model</label><br>
      <input id="es-model" value="gemini-2.5-pro-preview-05-06"
        style="width:100%;box-sizing:border-box;padding:7px 10px;margin:4px 0 12px;
               border:1px solid #ccc;border-radius:6px;font-size:13px;"><br>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <label style="font-size:12px;"><input type="checkbox" id="es-auto" checked> Auto-select</label>
        <label style="font-size:12px;"><input type="checkbox" id="es-log">  Show reasoning</label>
      </div>
      <button id="es-start"
        style="width:100%;padding:9px;background:#2196F3;color:#fff;border:none;
               border-radius:6px;font-size:14px;cursor:pointer;">Start Solver</button>
      <div id="es-err" style="color:red;font-size:12px;margin-top:8px;"></div>`;

    document.body.appendChild(form);

    document.getElementById('es-start').onclick = () => {
      const key = document.getElementById('es-key').value.trim();
      if (!key) { document.getElementById('es-err').textContent = 'API key required.'; return; }
      form.remove();
      boot({
        GEMINI_API_KEY: key,
        MODEL:          document.getElementById('es-model').value.trim() || 'gemini-2.5-pro-preview-05-06',
        HIGHLIGHT_COLOR:'#ffeb3b',
        SELECTED_COLOR: '#4caf50',
        AUTO_SELECT:    document.getElementById('es-auto').checked,
        SHOW_REASONING: document.getElementById('es-log').checked,
      });
    };

    // Allow Enter key to submit
    document.getElementById('es-key').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('es-start').click();
    });
  }

  // Everything else lives inside boot() so it only runs after CONFIG is ready.
  function boot(CONFIG) {

  let questions = [], solutions = [], panel = null;

  // ─── HELPERS ─────────────────────────────────────────────────────────────────

  const cleanText = s => (s || '').replace(/\s+/g, ' ').trim();

  /**
   * Simulates a full HTML5 drag-and-drop sequence.
   * Async version with delays so React processes each event.
   */
  async function simulateDrag(sourceEl, targetEl) {
    const dt = new DataTransfer();
    const fire = (el, type) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));

    fire(sourceEl, 'dragstart');
    await delay(60);
    fire(targetEl, 'dragenter');
    await delay(60);
    fire(targetEl, 'dragover');
    await delay(60);
    fire(targetEl, 'drop');
    await delay(60);
    fire(sourceEl, 'dragend');
    await delay(150); // let React flush state
  }

  /**
   * Simulates mousedown + mouseup + click to trick React synthetic event system.
   */
  function reactClick(el) {
    ['mousedown', 'mouseup', 'click'].forEach(type =>
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
  }

  /**
   * Opens a custom eMaktab dropdown and clicks the matching option.
   *
   * Strategy:
   *  1. Click the trigger to open the menu.
   *  2. Poll for a popup that appears NEAR the trigger (positional proximity).
   *  3. Inside that popup, collect every leaf text node as a candidate.
   *  4. Pick the best fuzzy match and click it.
   *
   * This handles eMaktab's custom React dropdowns whose options are plain
   * <div>/<p> elements with no semantic role attributes.
   */
  async function selectDropdown(triggerEl, answerText) {
    const norm = s => cleanText(s).toLowerCase().replace(/\s+/g, ' ');
    const target = norm(answerText);

    // Remember bounding rect of the trigger so we can find its popup.
    const triggerRect = triggerEl.getBoundingClientRect();

    // Open the dropdown.
    reactClick(triggerEl);

    // ── Step 1: find the popup container ──────────────────────────────────────
    // We look for any element that (a) appeared after the click, (b) is visible,
    // (c) is positioned close to the trigger (within 400 px vertically).
    let popup = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await delay(80);

      // Candidate containers: common class names eMaktab / React-Select use.
      const containerSelectors = [
        '[class*="menu"]', '[class*="dropdown"]', '[class*="select"]',
        '[class*="listbox"]', '[class*="options"]', '[class*="popup"]',
        '[role="listbox"]', '[role="menu"]',
      ];

      for (const sel of containerSelectors) {
        const candidates = [...document.querySelectorAll(sel)].filter(el => {
          if (!el.offsetParent) return false;           // must be visible
          const r = el.getBoundingClientRect();
          if (r.width < 30 || r.height < 10) return false; // must have size
          // Must be near the trigger vertically
          return Math.abs(r.top - triggerRect.bottom) < 400 ||
                 Math.abs(r.bottom - triggerRect.top) < 400;
        });
        if (candidates.length) { popup = candidates[0]; break; }
      }

      // Fallback: if still no popup, scan for any newly-visible element whose
      // text exactly matches one of the answer words (for eMaktab's bare divs).
      if (!popup) {
        const allVisible = [...document.querySelectorAll('div, p, span')]
          .filter(el => {
            if (!el.offsetParent) return false;
            const r = el.getBoundingClientRect();
            return r.width > 20 && r.height > 8 &&
                   r.top > triggerRect.top - 10 &&
                   r.top < triggerRect.bottom + 350;
          });

        // Find one whose text is a short option-like string containing our answer
        const directHit = allVisible.find(el => {
          const t = norm(el.innerText || el.textContent);
          return t.length < 60 && (t === target || t.includes(target) || target.includes(t));
        });

        if (directHit) {
          // The element itself is the option — click it directly.
          reactClick(directHit);
          console.log(`[Dropdown] Direct hit: "${cleanText(directHit.innerText)}"`);
          return true;
        }
      }

      if (popup) break;
    }

    // ── Step 2: collect leaf-level option elements inside popup ───────────────
    if (popup) {
      // Walk all descendant elements; prefer leaves (no child elements with text).
      const allEls = [...popup.querySelectorAll('*')].filter(el => el.offsetParent !== null);

      // Score each element: exact match > contains > contained-in
      const scored = allEls
        .map(el => {
          const t = norm(el.innerText || el.textContent || '');
          if (!t || t.length > 80) return null;
          let score = 0;
          if (t === target) score = 3;
          else if (t.includes(target)) score = 2;
          else if (target.includes(t) && t.length > 1) score = 1;
          return score > 0 ? { el, score, t } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.t.length - b.t.length); // prefer shorter = more leaf-like

      if (scored.length) {
        const best = scored[0].el;
        reactClick(best);
        console.log(`[Dropdown] Selected (score ${scored[0].score}): "${cleanText(best.innerText)}"`);
        return true;
      }

      console.warn(`[Dropdown] Popup found but no match for "${answerText}". Options:`,
        allEls.map(e => cleanText(e.innerText)).filter(t => t && t.length < 60));
    } else {
      console.warn(`[Dropdown] No popup detected for trigger. Answer: "${answerText}"`);
    }

    // Close any stray open menu.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    console.warn(`[Dropdown] Could not select: "${answerText}"`);
    return false;
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ─── UI PANEL ────────────────────────────────────────────────────────────────

  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'emaktab-solver-panel';
    panel.style.cssText = `
      position:fixed;top:20px;right:20px;width:360px;max-height:80vh;
      background:#fff;border:2px solid #2196F3;border-radius:10px;
      padding:15px;box-shadow:0 4px 20px rgba(0,0,0,.3);
      z-index:999999;font-family:Arial,sans-serif;overflow-y:auto;color:#333;
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:12px;border-bottom:2px solid #eee;padding-bottom:10px;">
        <h3 style="margin:0;color:#2196F3;font-size:15px;">Emaktab Solver v2</h3>
        <button id="sp-close" style="background:none;border:none;font-size:20px;cursor:pointer;">✖</button>
      </div>
      <div id="sp-status" style="margin-bottom:12px;padding:8px;background:#e3f2fd;border-radius:5px;font-size:13px;">
        Ready · ${CONFIG.MODEL}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button id="sp-extract" style="flex:1;padding:7px;background:#4caf50;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;">Extract</button>
        <button id="sp-solve"   style="flex:1;padding:7px;background:#2196F3;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;">Solve All</button>
        <button id="sp-select"  style="flex:1;padding:7px;background:#ff9800;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;">Select All</button>
      </div>
      <div style="display:flex;gap:5px;margin-bottom:12px;">
        <button id="sp-export" style="flex:1;padding:5px;background:#9c27b0;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;">Export</button>
        <button id="sp-clear"  style="flex:1;padding:5px;background:#f44336;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;">Clear</button>
      </div>
      <div id="sp-list" style="max-height:380px;overflow-y:auto;border:1px solid #ddd;padding:8px;border-radius:5px;font-size:12px;">
        Click Extract to begin.
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('sp-close').onclick   = () => panel.remove();
    document.getElementById('sp-extract').onclick = extractQuestions;
    document.getElementById('sp-solve').onclick   = solveAllQuestions;
    document.getElementById('sp-select').onclick  = selectAllAnswers;
    document.getElementById('sp-export').onclick  = exportData;
    document.getElementById('sp-clear').onclick   = clearAll;
  }

  function setStatus(msg, type = 'info') {
    const el = document.getElementById('sp-status');
    if (el) {
      const bg = { info: '#e3f2fd', success: '#c8e6c9', error: '#ffcdd2', warning: '#fff3e0' };
      el.style.background = bg[type] || bg.info;
      el.innerHTML = msg;
    }
    console.log(`[${type.toUpperCase()}] ${msg}`);
  }

  // ─── EXTRACT ─────────────────────────────────────────────────────────────────

  async function extractQuestions() {
    questions = [];
    const blocks = document.querySelectorAll('[data-test-id^="block-"]');
    if (!blocks.length) { setStatus('No blocks found!', 'error'); return; }

    blocks.forEach((block, index) => {
      block.style.outline = `3px solid ${CONFIG.HIGHLIGHT_COLOR}`;
      block.style.outlineOffset = '2px';

      // Detect type
      const hasDraggable = block.querySelectorAll('.cYZNy[draggable="true"]').length > 0;
      const hasMatching  = !hasDraggable && block.querySelectorAll('.YBX37.bdL_6').length > 0;
      const optionEls    = block.querySelectorAll('[data-test-id^="answer-"]');
      const dropdownEls  = block.querySelectorAll('.DtVSJ.dbzdF');

      const q = {
        index, block,
        text: cleanText(block.innerText),
        type: hasDraggable   ? 'dragdrop'  :
              hasMatching    ? 'matching'  :
              optionEls.length    ? 'choice'   :
              dropdownEls.length  ? 'dropdown' : 'unknown',
        options:        [],   // choice / reference for dragdrop items
        dropdowns:      [],
        matchingFacts:  [],   // matching: fact items (left side)
        matchingNames:  [],   // matching: name items (right side)
        dragCategories: [],   // dragdrop: { catName, dropZone, items[] }
      };

      // ── DRAG-DROP ──
      if (q.type === 'dragdrop') {
        block.querySelectorAll('.MK4I4').forEach(col => {
          const catName  = cleanText(col.querySelector('.JZ8_6')?.innerText || 'Unknown');
          // .tMlqT is the empty droppable zone at the bottom of each column
          const dropZone = col.querySelector('.tMlqT') || col;
          const items    = [...col.querySelectorAll('.cYZNy[draggable="true"]')];

          q.dragCategories.push({ catName, dropZone, items });

          items.forEach(el => q.options.push({
            element: el,
            text: cleanText(el.innerText),
            currentCat: catName,
          }));
        });
      }

      // ── MATCHING ──
      // Items in .YBX37.bdL_6 alternate: fact, name, (nAcaS spacer), fact, name, …
      // We detect names by monument-name heuristic.
      else if (q.type === 'matching') {
        const MONUMENT_RE = /madrasa|toqi|zargaron|baroqxon|mir arab|ko.kaldosh|modarixon|abdulloxon/i;
        block.querySelectorAll('.YBX37.bdL_6').forEach(row => {
          const txt = cleanText(row.innerText);
          if (MONUMENT_RE.test(txt)) q.matchingNames.push({ element: row, text: txt });
          else                        q.matchingFacts.push({ element: row, text: txt });
        });
      }

      // ── CHOICE ──
      else if (q.type === 'choice') {
        optionEls.forEach(el => q.options.push({ element: el, text: cleanText(el.innerText) }));
      }

      // ── DROPDOWN ──
      // Also peek inside the closed dropdown to grab available option texts,
      // so the AI prompt can reference them and return exact matching strings.
      else if (q.type === 'dropdown') {
        dropdownEls.forEach(el => {
          const optEls = el.querySelectorAll('li, [role="option"], div > p, div > span');
          const preloadedOpts = [...optEls]
            .map(o => cleanText(o.innerText))
            .filter(t => t && t.length < 50 && t !== cleanText(el.innerText));
          q.dropdowns.push({ element: el, preloadedOpts });
        });
      }

      questions.push(q);
    });

    renderList();
    setStatus(`Extracted ${questions.length} questions — scanning dropdowns…`, 'success');
    await prescanDropdowns();
    setStatus(`Extracted ${questions.length} questions`, 'success');

    // Copy summary to clipboard
    const summary = questions.map(q => ({
      index: q.index, type: q.type,
      text: q.text.substring(0, 80),
      dragCategories: q.dragCategories.map(c => ({ cat: c.catName, count: c.items.length })),
      matchingFacts: q.matchingFacts.length,
      matchingNames: q.matchingNames.length,
      options: q.options.length,
      dropdowns: q.dropdowns.length,
    }));
    copyToClipboard(JSON.stringify(summary, null, 2));
  }

  /**
   * For each dropdown question, briefly open each dropdown to harvest its
   * option list, then close it. This runs once after extraction so that
   * solveQuestion() can include the real option texts in the AI prompt.
   */
  async function prescanDropdowns() {
    const ddQuestions = questions.filter(q => q.type === 'dropdown');
    if (!ddQuestions.length) return;

    console.log(`[Prescan] Scanning ${ddQuestions.length} dropdown question(s)…`);

    for (const q of ddQuestions) {
      for (const dd of q.dropdowns) {
        if (dd.preloadedOpts && dd.preloadedOpts.length) continue; // already have options

        // Open dropdown
        reactClick(dd.element);
        await delay(500); // wait for React to render the list

        // Collect all short, visible text nodes near the dropdown
        const triggerRect = dd.element.getBoundingClientRect();
        const candidates = [...document.querySelectorAll('*')].filter(el => {
          if (!el.offsetParent) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height < 5) return false;
          return r.top >= triggerRect.bottom - 5 && r.top <= triggerRect.bottom + 400;
        });

        const opts = candidates
          .map(el => cleanText(el.innerText || el.textContent))
          .filter(t => t && t.length > 0 && t.length < 60)
          .filter((t, i, arr) => arr.indexOf(t) === i); // dedupe

        if (opts.length) {
          dd.preloadedOpts = opts;
          console.log(`[Prescan] Found options for blank:`, opts);
        }

        // Close
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await delay(300);
      }
    }
    console.log('[Prescan] Done.');
  }

  // ─── RENDER LIST ─────────────────────────────────────────────────────────────

  function renderList() {
    const el = document.getElementById('sp-list');
    if (!el) return;
    if (!questions.length) { el.innerHTML = 'No questions.'; return; }

    el.innerHTML = questions.map((q, i) => {
      const sol  = solutions.find(s => s.index === i);
      const icon = sol ? (sol.solution ? '✅' : '❌') : '⏳';
      return `
        <div style="margin-bottom:10px;padding:8px;background:#f5f5f5;border-radius:4px;
                    border-left:4px solid ${sol ? '#4caf50' : '#ff9800'}">
          <div style="display:flex;justify-content:space-between;">
            <strong>Q${i+1} ${icon}</strong>
            <span style="font-size:10px;background:#ddd;padding:1px 4px;border-radius:3px;">${q.type}</span>
          </div>
          <div style="margin:3px 0;color:#555;">${q.text.substring(0, 90)}…</div>
          ${sol ? `<div style="background:#e8f5e8;padding:3px 5px;border-radius:3px;margin-bottom:4px;">
                     <strong>Answer:</strong> ${(sol.solution || '').substring(0, 120)}</div>` : ''}
          <button class="sp-solve-one"  data-i="${i}" style="margin-right:4px;padding:2px 7px;background:#2196F3;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;">Solve</button>
          <button class="sp-select-one" data-i="${i}" style="padding:2px 7px;background:#ff9800;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;">Select</button>
        </div>`;
    }).join('');

    el.querySelectorAll('.sp-solve-one').forEach(b => b.onclick  = () => solveQuestion(+b.dataset.i));
    el.querySelectorAll('.sp-select-one').forEach(b => b.onclick = () => selectAnswer(+b.dataset.i));
  }

  // ─── GEMINI API ──────────────────────────────────────────────────────────────

  function extractText(data) {
    try {
      const c = data.candidates?.[0];
      return c?.content?.parts?.[0]?.text || c?.content?.text || c?.text || '[No text]';
    } catch { return '[Error]'; }
  }

  async function callGemini(prompt) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return extractText(data);
  }

  // ─── SOLVE ONE ───────────────────────────────────────────────────────────────

  async function solveQuestion(index) {
    const q = questions[index];
    if (!q) return;
    setStatus(`Solving Q${index + 1}…`, 'info');
    q.block.style.outline = '3px solid #ff9800';

    let prompt = '';

    if (q.type === 'choice') {
      prompt = `Multiple choice – reply with ONLY the letter (A/B/C/D):
${q.text}
${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n')}`;

    } else if (q.type === 'matching') {
      prompt = `Matching question. Match each FACT number to the correct MONUMENT letter.
Facts:
${q.matchingFacts.map((f, i) => `${i + 1}. ${f.text}`).join('\n')}
Monuments:
${q.matchingNames.map((n, i) => `${String.fromCharCode(65 + i)}. ${n.text}`).join('\n')}
Reply ONLY in format: 1-A, 2-B, 3-C, 4-D`;

    } else if (q.type === 'dragdrop') {
      const cats  = q.dragCategories.map(c => c.catName);
      const items = q.options.map((o, i) => `${i + 1}. ${o.text}`).join('\n');
      prompt = `Categorize each item under the correct ruler.
Categories: ${cats.join(', ')}
Items:
${items}
Reply ONLY in this exact format (one line per category):
${cats[0]}: 1, 3
${cats[1]}: 2, 4`;

    } else if (q.type === 'dropdown') {
      // Build per-blank option hints if we were able to pre-load them
      const blankDescriptions = q.dropdowns.map((dd, i) => {
        const opts = dd.preloadedOpts && dd.preloadedOpts.length
          ? `\n   Available choices: ${dd.preloadedOpts.join(', ')}`
          : '';
        return `Blank ${i + 1}:${opts}`;
      }).join('\n');
      prompt = `Fill in the blanks. You MUST reply ONLY with the answers as a comma-separated list — nothing else.
Each answer must exactly match one of the available choices listed below (same spelling, same case).

Question text:
${q.text}

${blankDescriptions}

Reply format example: UGU, тирозин, серин`;
    } else {
      setStatus(`Q${index + 1}: unknown type`, 'warning');
      return;
    }

    try {
      let raw = await callGemini(prompt);
      let solution = raw.trim();

      if (q.type === 'choice') {
        const m = raw.match(/\b([A-D])\b/); if (m) solution = m[1];
      } else if (q.type === 'matching') {
        const m = raw.match(/\d+-[A-Z]/g); if (m) solution = m.join(', ');
      }

      solutions = solutions.filter(s => s.index !== index);
      solutions.push({ index, type: q.type, solution, fullResponse: raw });

      q.block.style.outline = `3px solid ${CONFIG.SELECTED_COLOR}`;
      setStatus(`Q${index + 1} solved!`, 'success');
      if (CONFIG.SHOW_REASONING) console.log(`[Q${index + 1}] Raw:`, raw);
      if (CONFIG.AUTO_SELECT) await selectAnswer(index);
      renderList();
    } catch (e) {
      setStatus(`Error Q${index + 1}: ${e.message}`, 'error');
      q.block.style.outline = '3px solid #f44336';
      console.error(e);
    }
  }

  // ─── SELECT ONE ──────────────────────────────────────────────────────────────

  async function selectAnswer(index) {
    const q   = questions[index];
    const sol = solutions.find(s => s.index === index);
    if (!q || !sol) { setStatus(`No solution for Q${index + 1}`, 'error'); return; }

    // ── CHOICE ──
    if (q.type === 'choice') {
      const idx = sol.solution.toUpperCase().charCodeAt(0) - 65;
      if (idx >= 0 && idx < q.options.length) {
        reactClick(q.options[idx].element);
        q.options[idx].element.style.outline = `3px solid ${CONFIG.SELECTED_COLOR}`;
        q.options[idx].element.style.backgroundColor = '#e8f5e8';
      }
    }

    // ── MATCHING ──
    // Click FACT first (activates it), then click NAME to pair them.
    else if (q.type === 'matching') {
      const pairs = sol.solution.match(/\d+-[A-Z]/g);
      if (!pairs) { setStatus(`Manual matching needed for Q${index + 1}`, 'warning'); return; }

      for (const pair of pairs) {
        const [fStr, nStr] = pair.split('-');
        const fi = parseInt(fStr) - 1;
        const ni = nStr.charCodeAt(0) - 65;

        if (fi < 0 || fi >= q.matchingFacts.length) continue;
        if (ni < 0 || ni >= q.matchingNames.length)  continue;

        reactClick(q.matchingFacts[fi].element);
        await delay(250);
        reactClick(q.matchingNames[ni].element);
        await delay(250);

        q.matchingFacts[fi].element.style.outline = `2px solid ${CONFIG.SELECTED_COLOR}`;
        q.matchingNames[ni].element.style.outline = `2px solid ${CONFIG.SELECTED_COLOR}`;
        console.log(`[Match] "${q.matchingFacts[fi].text}" → "${q.matchingNames[ni].text}"`);
      }
      setStatus(`Matching done Q${index + 1}`, 'success');
    }

    // ── DRAG-DROP ──
    else if (q.type === 'dragdrop') {
      console.log(`[Drag] Solution for Q${index + 1}:`, sol.solution);

      // Parse lines: "Shayboniyxon: 1, 3"
      for (const line of sol.solution.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const catLabel = line.substring(0, colonIdx).trim();
        const nums     = (line.substring(colonIdx + 1).match(/\d+/g) || []).map(Number);

        // Find matching category by partial name match (handles Cyrillic/Latin variants)
        const cat = q.dragCategories.find(c =>
          c.catName.toLowerCase().includes(catLabel.toLowerCase()) ||
          catLabel.toLowerCase().includes(c.catName.toLowerCase())
        );

        if (!cat) {
          console.warn(`[Drag] Category not found: "${catLabel}"`);
          continue;
        }

        for (const num of nums) {
          const itemIdx = num - 1;
          if (itemIdx < 0 || itemIdx >= q.options.length) continue;

          const sourceEl = q.options[itemIdx].element;
          // Already in correct category — skip
          if (q.options[itemIdx].currentCat === cat.catName) continue;

          await simulateDrag(sourceEl, cat.dropZone);
          q.options[itemIdx].currentCat = cat.catName;
          sourceEl.style.outline = `2px solid ${CONFIG.SELECTED_COLOR}`;
          sourceEl.style.backgroundColor = '#e8f5e8';
          console.log(`[Drag] Item ${num} → "${cat.catName}"`);
        }
      }
      setStatus(`Drag-drop done Q${index + 1}`, 'success');
    }

    // ── DROPDOWN ──
    else if (q.type === 'dropdown') {
      const answers = sol.solution.split(',').map(a => a.trim());
      for (let j = 0; j < Math.min(answers.length, q.dropdowns.length); j++) {
        const ok = await selectDropdown(q.dropdowns[j].element, answers[j]);
        if (!ok) console.warn(`[Dropdown] blank ${j + 1}: "${answers[j]}" not found`);
        await delay(400);
      }
      setStatus(`Dropdowns filled Q${index + 1}`, 'success');
    }
  }

  // ─── SOLVE / SELECT ALL ──────────────────────────────────────────────────────

  async function solveAllQuestions() {
    if (!questions.length) { setStatus('Extract first!', 'error'); return; }
    const btn = document.getElementById('sp-solve');
    if (btn) btn.disabled = true;

    for (let i = 0; i < questions.length; i++) {
      if (!solutions.find(s => s.index === i)) {
        await solveQuestion(i);
        await delay(1500); // rate-limit buffer between Gemini calls
      }
    }

    if (btn) btn.disabled = false;
    setStatus('All questions solved!', 'success');
  }

  async function selectAllAnswers() {
    for (let i = 0; i < questions.length; i++) {
      await selectAnswer(i);
      await delay(300);
    }
    setStatus('All answers selected!', 'success');
  }

  // ─── EXPORT / CLEAR ──────────────────────────────────────────────────────────

  function exportData() {
    copyToClipboard(JSON.stringify({
      timestamp: new Date().toISOString(),
      questions: questions.map(q => ({
        index: q.index, type: q.type, text: q.text,
        options:       q.options.map(o => o.text),
        matchingFacts: q.matchingFacts.map(f => f.text),
        matchingNames: q.matchingNames.map(n => n.text),
        dragCategories: q.dragCategories.map(c => ({ cat: c.catName, items: c.items.length })),
        dropdowns:     q.dropdowns.length,
      })),
      solutions,
    }, null, 2));
    setStatus('Exported to clipboard!', 'success');
  }

  function clearAll() {
    questions = []; solutions = [];
    document.querySelectorAll('[data-test-id^="block-"]').forEach(el => {
      el.style.outline = ''; el.style.outlineOffset = '';
    });
    renderList();
    setStatus('Cleared', 'info');
  }

  function copyToClipboard(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  // ─── INIT ────────────────────────────────────────────────────────────────────

    createPanel();
    console.log('%cEmaktab Solver v2 loaded!', 'color:#2196F3;font-weight:bold;font-size:14px');

  } // end boot()

})();
