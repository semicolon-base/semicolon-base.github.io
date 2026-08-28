/* text edit mode: open any page with ?text=1. every text block becomes
   editable in place; headings grow size and weight controls; "copy edits"
   puts a JSON of everything you changed on the clipboard, to hand to Claude
   to fold into the source, and "download page" saves the edited html file.
   links are disabled while editing so clicks land in the text. */
(function () {
  if (!/[?&]text=1/.test(location.search)) return;

  var SEL = 'h1,h2,h3,h4,p,summary,figcaption,li,nav a,footer span,footer a,' +
            '.st,.stage,.more,.pill,.tag,.lbl,.srcgrid .cell b,.dlead,.status b';
  var HEAD = 'h1,h2,h3,h4';

  var els = [];
  document.querySelectorAll(SEL).forEach(function (el) {
    if (el.closest('.ed-bar,.ed-tools,.opt-switch,.hovercard')) return;
    if (el.querySelector('h1,h2,h3,h4,p,summary,li')) return;
    if (!el.textContent.trim()) return;
    els.push(el);
  });
  var orig = els.map(function (el) { return el.innerHTML; });
  els.forEach(function (el, i) {
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    el.dataset.eid = i;
    el.classList.add('ed-t');
  });

  /* no navigating away mid-edit */
  document.addEventListener('click', function (e) {
    if (e.target.closest('.ed-bar,.ed-tools')) return;
    if (e.target.closest('a')) e.preventDefault();
  }, true);

  var css = document.createElement('style');
  css.textContent =
    '.ed-t{outline:1px dashed rgba(224,169,60,.55);outline-offset:2px;min-width:8px;}' +
    '.ed-t:hover{outline-color:rgba(224,169,60,.95);}' +
    '.ed-t:focus{outline:2px solid var(--marigold);}' +
    '.ed-bar{position:fixed;left:10px;bottom:10px;z-index:120;display:flex;gap:10px;' +
      'align-items:center;background:#fff;border:1px solid rgba(43,42,39,.25);' +
      "border-radius:3px;padding:8px 10px;font:600 11.5px/1 'Archivo',sans-serif;}" +
    '.ed-bar b{font-weight:600;color:#9E2B25;}' +
    '.ed-bar button{font:600 11.5px/1 Archivo,sans-serif;border:1px solid rgba(43,42,39,.3);' +
      'background:#fff;border-radius:3px;padding:6px 9px;cursor:pointer;color:#2B2A27;}' +
    '.ed-bar button:hover{background:#FBF6EC;border-color:#E0A93C;}' +
    '.ed-bar .n{color:rgba(43,42,39,.5);font-weight:500;}' +
    '.ed-tools{position:fixed;z-index:121;display:none;gap:7px;align-items:center;' +
      'background:#fff;border:1px solid rgba(43,42,39,.25);border-radius:3px;' +
      "padding:6px 8px;font:600 11px/1 'Archivo',sans-serif;color:rgba(43,42,39,.6);}" +
    '.ed-tools.on{display:flex;}' +
    '.ed-tools input,.ed-tools select{font:600 11.5px/1.2 Archivo,sans-serif;' +
      'border:1px solid rgba(43,42,39,.25);border-radius:2px;padding:3px 4px;color:#2B2A27;}' +
    '.ed-tools input{width:52px;}' +
    '.ed-tools a{border:none;color:#9E2B25;font-weight:600;cursor:pointer;padding:0 2px;}';
  document.head.appendChild(css);

  /* the heading tools: size and weight for whichever heading holds the caret */
  var tools = document.createElement('div');
  tools.className = 'ed-tools';
  tools.innerHTML = '<span>size</span><input type="number" step="0.5" min="9" max="90">' +
    '<span>weight</span><select><option>300</option><option>400</option><option>500</option>' +
    '<option>600</option><option>700</option><option>800</option></select><a>reset</a>';
  document.body.appendChild(tools);
  var sizeIn = tools.querySelector('input'),
      weightIn = tools.querySelector('select'),
      resetBt = tools.querySelector('a'),
      target = null;
  var styled = {};   /* eid -> {size, weight} */

  function showTools(el) {
    target = el;
    var cs = getComputedStyle(el);
    sizeIn.value = Math.round(parseFloat(cs.fontSize) * 2) / 2;
    weightIn.value = String(Math.round(parseFloat(cs.fontWeight) / 100) * 100);
    var r = el.getBoundingClientRect();
    tools.classList.add('on');
    var y = r.top - tools.offsetHeight - 8;
    if (y < 8) y = r.bottom + 8;
    tools.style.top = y + 'px';
    tools.style.left = Math.max(8, Math.min(r.left, innerWidth - tools.offsetWidth - 8)) + 'px';
  }
  sizeIn.addEventListener('input', function () {
    if (!target) return;
    target.style.fontSize = sizeIn.value + 'px';
    (styled[target.dataset.eid] = styled[target.dataset.eid] || {}).size = sizeIn.value + 'px';
    count();
  });
  weightIn.addEventListener('change', function () {
    if (!target) return;
    target.style.fontWeight = weightIn.value;
    (styled[target.dataset.eid] = styled[target.dataset.eid] || {}).weight = weightIn.value;
    count();
  });
  resetBt.addEventListener('click', function () {
    if (!target) return;
    target.style.fontSize = '';
    target.style.fontWeight = '';
    delete styled[target.dataset.eid];
    showTools(target);
    count();
  });
  document.addEventListener('focusin', function (e) {
    if (e.target.closest('.ed-tools,.ed-bar')) return;
    var h = e.target.closest && e.target.closest(HEAD);
    if (h && h.classList.contains('ed-t')) showTools(h);
    else tools.classList.remove('on');
  });
  addEventListener('scroll', function () {
    if (target && tools.classList.contains('on')) showTools(target);
  }, { passive: true });

  /* the bar: change count, copy edits, download page */
  var bar = document.createElement('div');
  bar.className = 'ed-bar';
  bar.innerHTML = '<b>text edit</b><span class="n">0 changed</span>' +
    '<button class="cp">copy edits</button><button class="dl">download page</button>';
  document.body.appendChild(bar);
  var nEl = bar.querySelector('.n');

  function edits() {
    var out = [];
    els.forEach(function (el, i) {
      var st = styled[i] || {};
      var changed = el.innerHTML !== orig[i];
      if (!changed && !st.size && !st.weight) return;
      var was = orig[i].replace(/<[^>]+>/g, '');
      out.push({
        id: i, tag: el.tagName.toLowerCase(),
        cls: el.className.replace(/\bed-t\b/, '').trim(),
        was: was.length > 70 ? was.slice(0, 70) + '...' : was,
        html: changed ? el.innerHTML : undefined,
        size: st.size, weight: st.weight
      });
    });
    return out;
  }
  function count() { nEl.textContent = edits().length + ' changed'; }
  document.addEventListener('input', count);

  bar.querySelector('.cp').addEventListener('click', function () {
    var payload = JSON.stringify({ page: location.pathname.split('/').pop(),
                                   edits: edits() }, null, 1);
    (navigator.clipboard ? navigator.clipboard.writeText(payload)
      : Promise.reject()).then(function () {
      nEl.textContent = 'copied, paste it to claude';
    }, function () { window.prompt('copy this:', payload); });
  });

  bar.querySelector('.dl').addEventListener('click', function () {
    var doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('.ed-bar,.ed-tools').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('.ed-t').forEach(function (n) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
      n.removeAttribute('data-eid');
      n.classList.remove('ed-t');
      if (!n.className) n.removeAttribute('class');
    });
    doc.querySelectorAll('style').forEach(function (n) {
      if (n.textContent.indexOf('.ed-bar{') > -1) n.remove();
    });
    var blob = new Blob(['<!doctype html>\n' + doc.outerHTML], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (location.pathname.split('/').pop() || 'index.html')
                   .replace('.html', '') + '-edited.html';
    a.click();
  });
})();
