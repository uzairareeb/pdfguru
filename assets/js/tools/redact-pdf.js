/* PDFGuru — Redact PDF. Drag on the page preview to draw black redaction
   boxes; undo the last one if needed. On download, the boxes are burned into
   the PDF with pdf-lib as opaque black rectangles. */
(function () {
  'use strict';

  var file = null;
  var fileBytes = null;
  var pdfDoc = null;
  var pageCount = 0;
  var rects = []; // { page, xPct, yPct, wPct, hPct }

  var PREVIEW_W = 720;

  function curPage() {
    return parseInt(PG.el('pageSelect').value, 10) || 1;
  }

  function ensureStage() {
    var wrap = PG.el('stageWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'stageWrap';
      wrap.className = 'stage';
      wrap.style.margin = '16px 0';
      wrap.style.maxWidth = PREVIEW_W + 'px';
      wrap.style.touchAction = 'none';
      wireDrag(wrap);
      var opts = PG.el('optionsArea');
      opts.parentNode.insertBefore(wrap, opts);
    }
    return wrap;
  }

  function renderFileRow() {
    var list = PG.el('fileList');
    list.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'file-row';
    var name = document.createElement('span');
    name.className = 'fname';
    name.textContent = file.name;
    var size = document.createElement('span');
    size.className = 'fsize';
    size.textContent = PG.fileSize(file.size);
    row.appendChild(name);
    row.appendChild(size);
    list.appendChild(row);
  }

  async function loadFile(f) {
    file = f;
    fileBytes = await PG.readAsArrayBuffer(f);
    pdfDoc = await pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    pageCount = pdfDoc.numPages;
    rects = [];
    var sel = PG.el('pageSelect');
    sel.innerHTML = '';
    for (var i = 1; i <= pageCount; i++) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = 'Page ' + i;
      sel.appendChild(o);
    }
    renderFileRow();
    await renderPreview();
    PG.el('processBtn').disabled = false;
  }

  async function renderPreview() {
    var wrap = ensureStage();
    wrap.innerHTML = '';
    var page = await pdfDoc.getPage(curPage());
    var v1 = page.getViewport({ scale: 1 });
    var viewport = page.getViewport({ scale: PREVIEW_W / v1.width });
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    canvas.draggable = false;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    wrap.appendChild(canvas);
    drawRectOverlays();
  }

  function drawRectOverlays() {
    var wrap = PG.el('stageWrap');
    if (!wrap) return;
    var olds = wrap.querySelectorAll('.annot.redactbox');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    rects.forEach(function (r) {
      if (r.page !== curPage()) return;
      var d = document.createElement('div');
      d.className = 'annot redactbox';
      d.style.position = 'absolute';
      d.style.left = r.xPct + '%';
      d.style.top = r.yPct + '%';
      d.style.width = r.wPct + '%';
      d.style.height = r.hPct + '%';
      d.style.background = '#000';
      d.style.opacity = '0.85';
      d.style.pointerEvents = 'none';
      d.style.zIndex = '5';
      wrap.appendChild(d);
    });
  }

  function wireDrag(wrap) {
    var active = null;
    wrap.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      var rect = wrap.getBoundingClientRect();
      var sx = ((ev.clientX - rect.left) / rect.width) * 100;
      var sy = ((ev.clientY - rect.top) / rect.height) * 100;
      var ghost = document.createElement('div');
      ghost.className = 'annot redactbox';
      ghost.style.position = 'absolute';
      ghost.style.background = '#000';
      ghost.style.opacity = '0.6';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '6';
      wrap.appendChild(ghost);
      active = { sx: sx, sy: sy, ghost: ghost, rect: rect };
      try { wrap.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    wrap.addEventListener('pointermove', function (ev) {
      if (!active) return;
      var rect = wrap.getBoundingClientRect();
      var cx = ((ev.clientX - rect.left) / rect.width) * 100;
      var cy = ((ev.clientY - rect.top) / rect.height) * 100;
      var x = Math.min(active.sx, cx), y = Math.min(active.sy, cy);
      active.ghost.style.left = x + '%';
      active.ghost.style.top = y + '%';
      active.ghost.style.width = Math.abs(cx - active.sx) + '%';
      active.ghost.style.height = Math.abs(cy - active.sy) + '%';
    });
    function finish(ev) {
      if (!active) return;
      var rect = wrap.getBoundingClientRect();
      var cx = ((ev.clientX - rect.left) / rect.width) * 100;
      var cy = ((ev.clientY - rect.top) / rect.height) * 100;
      var x = Math.min(active.sx, cx), y = Math.min(active.sy, cy);
      var w = Math.abs(cx - active.sx), h = Math.abs(cy - active.sy);
      if (active.ghost.parentNode) active.ghost.parentNode.removeChild(active.ghost);
      if (w > 0.5 && h > 0.5) {
        rects.push({ page: curPage(), xPct: x, yPct: y, wPct: w, hPct: h });
        drawRectOverlays();
      }
      active = null;
    }
    wrap.addEventListener('pointerup', finish);
    wrap.addEventListener('pointercancel', function () {
      if (active && active.ghost.parentNode) active.ghost.parentNode.removeChild(active.ghost);
      active = null;
    });
  }

  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      var f = list[0];
      if (!f || !PG.isPdf(f)) { PG.fail('Please add a PDF file.'); return; }
      PG.resetWork();
      loadFile(f).catch(function (err) { PG.fail(err.message || 'Could not open that PDF.'); });
    }
  });

  var pageSel = PG.el('pageSelect');
  if (pageSel) pageSel.addEventListener('change', function () {
    renderPreview().catch(function (err) { PG.fail(err.message || 'Could not render that page.'); });
  });

  var undoBtn = PG.el('undoRedactBtn');
  if (undoBtn) undoBtn.addEventListener('click', function () {
    if (!rects.length) { PG.fail('Nothing to undo.'); return; }
    rects.pop();
    drawRectOverlays();
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('Choose a PDF file first.');
      if (!rects.length) throw new Error('Drag on the preview to draw at least one redaction box first.');
      var out = await PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true });
      var pages = out.getPages();
      for (var i = 0; i < rects.length; i++) {
        PG.setProgress(Math.round((i / rects.length) * 90), 'Applying redaction ' + (i + 1) + ' of ' + rects.length + '\u2026');
        await PG.tick();
        var r = rects[i];
        var pg = pages[r.page - 1];
        if (!pg) continue;
        var W = pg.getWidth(), H = pg.getHeight();
        pg.drawRectangle({
          x: (r.xPct / 100) * W,
          y: H - ((r.yPct + r.hPct) / 100) * H,
          width: (r.wPct / 100) * W,
          height: (r.hPct / 100) * H,
          color: PDFLib.rgb(0, 0, 0),
          opacity: 1
        });
      }
      PG.setProgress(96, 'Saving redacted PDF\u2026');
      await PG.tick();
      var saved = await out.save();
      PG.done(
        new Blob([saved], { type: 'application/pdf' }),
        'redacted.pdf',
        'Done! ' + rects.length + ' area(s) covered (' + PG.fileSize(saved.length) + '). Visual overlay redaction applied.'
      );
    } catch (err) {
      PG.fail(err.message || 'Redaction failed.');
      btn.disabled = false;
    }
  });

  PG.el('processBtn').disabled = true;
})();
