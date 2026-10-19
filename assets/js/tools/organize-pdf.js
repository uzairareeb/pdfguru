/* PDFGuru — Organize PDF. Reorder (drag & drop), rotate and delete pages with live thumbnails.
   Contract: IIFE, 'use strict', PG helpers from app.js, standard DOM ids.
   This script builds its own toolbar (#rotLeftBtn #rotRightBtn #delSelBtn) and div#thumbGrid
   inside optionsArea, styled with the existing .toolbar / .thumb-grid / .thumb classes.
   State: pages = [{ srcIndex, rot, sel }] in current order. Click toggles selection. */
(function () {
  'use strict';

  var fileName = '';
  var fileBytes = null; // pristine ArrayBuffer kept for pdf-lib at process time
  var pdfDoc = null;    // pdf.js document used for thumbnail rendering
  var pages = [];       // { srcIndex, rot, sel } in current display order
  var dragIdx = null;
  var THUMB_SCALE = 0.4;

  function hint(msg) {
    var h = PG.el('thumbHint');
    if (h) h.textContent = msg || 'Click pages to select them, drag to reorder.';
  }

  // ---- toolbar + grid, created by this script ----
  function buildWorkspace() {
    var area = PG.el('optionsArea');
    if (!area) return;
    area.innerHTML = '';

    var bar = document.createElement('div');
    bar.className = 'toolbar';
    function mkBtn(id, label, title, danger) {
      var b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.className = 'mini-btn' + (danger ? ' danger' : '');
      b.textContent = label;
      b.title = title;
      bar.appendChild(b);
      return b;
    }
    mkBtn('rotLeftBtn', '⟲ Rotate left', 'Rotate selected pages 90° counter-clockwise');
    mkBtn('rotRightBtn', '⟳ Rotate right', 'Rotate selected pages 90° clockwise');
    mkBtn('delSelBtn', 'Delete selected', 'Remove the selected pages', true);

    var h = document.createElement('span');
    h.id = 'thumbHint';
    h.style.cssText = 'font-size:0.8rem;color:var(--muted);align-self:center;';
    h.textContent = 'Add a PDF to start organizing its pages.';
    bar.appendChild(h);
    area.appendChild(bar);

    var grid = document.createElement('div');
    grid.id = 'thumbGrid';
    grid.className = 'thumb-grid';
    area.appendChild(grid);

    PG.el('rotLeftBtn').addEventListener('click', function () { rotateSelected(270); });
    PG.el('rotRightBtn').addEventListener('click', function () { rotateSelected(90); });
    PG.el('delSelBtn').addEventListener('click', deleteSelected);
  }

  function rotateSelected(delta) {
    var sel = pages.filter(function (p) { return p.sel; });
    if (!sel.length) { hint('Click one or more pages to select them first.'); return; }
    sel.forEach(function (p) { p.rot = (p.rot + delta) % 360; });
    hint('Rotated ' + sel.length + ' page' + (sel.length > 1 ? 's' : '') + '.');
    renderThumbs();
  }

  function deleteSelected() {
    var selCount = pages.filter(function (p) { return p.sel; }).length;
    if (!selCount) { hint('Click one or more pages to select them first.'); return; }
    if (selCount >= pages.length) { hint('A PDF needs at least one page — deselect one page first.'); return; }
    pages = pages.filter(function (p) { return !p.sel; });
    hint('Deleted ' + selCount + ' page' + (selCount > 1 ? 's' : '') + '.');
    renderThumbs();
  }

  function removePage(i) {
    if (pages.length <= 1) { hint('A PDF needs at least one page.'); return; }
    pages.splice(i, 1);
    hint('Page removed.');
    renderThumbs();
  }

  // ---- thumbnails ----
  function renderThumbs() {
    var grid = PG.el('thumbGrid');
    if (!grid || !pdfDoc) { if (grid) grid.innerHTML = ''; PG.el('processBtn').disabled = true; return; }
    grid.innerHTML = '';
    PG.el('processBtn').disabled = pages.length < 1;

    pages.forEach(function (p, idx) {
      var t = document.createElement('div');
      t.className = 'thumb' + (p.sel ? ' sel' : '');
      t.draggable = true;

      var c = document.createElement('canvas');
      t.appendChild(c);

      var pno = document.createElement('div');
      pno.className = 'pno';
      pno.textContent = 'Page ' + (idx + 1) + (p.rot ? ' • ↻' + p.rot + '°' : '');
      t.appendChild(pno);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '✕';
      del.title = 'Remove this page';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removePage(idx);
      });
      t.appendChild(del);

      t.addEventListener('click', function () {
        p.sel = !p.sel;
        t.classList.toggle('sel', p.sel);
      });

      t.addEventListener('dragstart', function (ev) {
        dragIdx = idx;
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', String(idx)); } catch (e) {}
        t.classList.add('dragging');
      });
      t.addEventListener('dragend', function () {
        t.classList.remove('dragging');
        dragIdx = null;
      });
      t.addEventListener('dragover', function (ev) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
      });
      t.addEventListener('drop', function (ev) {
        ev.preventDefault();
        if (dragIdx === null || dragIdx === idx) return;
        var moved = pages.splice(dragIdx, 1)[0];
        pages.splice(idx, 0, moved);
        dragIdx = null;
        hint('Pages reordered.');
        renderThumbs();
      });

      grid.appendChild(t);

      // Render the page image (fire-and-forget; old canvases are discarded on re-render).
      pdfDoc.getPage(p.srcIndex + 1).then(function (page) {
        var base = page.rotate || 0;
        var viewport = page.getViewport({ scale: THUMB_SCALE, rotation: (base + p.rot) % 360 });
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        return page.render({ canvasContext: c.getContext('2d'), viewport: viewport }).promise;
      }).catch(function () { /* leave a blank thumbnail on render failure */ });
    });
  }

  // ---- file intake ----
  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: async function (list) {
      var pdfs = list.filter(function (f) { return PG.isPdf(f); });
      if (!pdfs.length) { PG.fail('Please add a PDF file.'); return; }
      var file = pdfs[0];
      PG.resetWork();
      try {
        fileName = file.name;
        fileBytes = await PG.readAsArrayBuffer(file);
        // pdf.js may transfer (neuter) the buffer, so hand it a copy.
        var copy = new Uint8Array(fileBytes.slice(0));
        pdfDoc = await pdfjsLib.getDocument({ data: copy }).promise;
        pages = [];
        for (var i = 0; i < pdfDoc.numPages; i++) pages.push({ srcIndex: i, rot: 0, sel: false });
        PG.el('processBtn').disabled = false;
        hint('Rendering ' + pdfDoc.numPages + ' thumbnails…');
        await PG.tick();
        renderThumbs();
      } catch (err) {
        PG.fail('"' + file.name + '" could not be opened. It may be password protected or damaged.');
        fileName = ''; fileBytes = null; pdfDoc = null; pages = [];
        renderThumbs();
      }
    }
  });

  // ---- process ----
  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    if (!pages.length || !fileBytes) { PG.fail('Please add a PDF file first.'); return; }
    btn.disabled = true;
    try {
      var src = await PDFLib.PDFDocument.load(fileBytes.slice(0));
      var out = await PDFLib.PDFDocument.create();
      for (var i = 0; i < pages.length; i++) {
        PG.setProgress(Math.round((i / pages.length) * 90),
          'Saving page ' + (i + 1) + ' of ' + pages.length + '…');
        await PG.tick();
        var p = pages[i];
        var copied = (await out.copyPages(src, [p.srcIndex]))[0];
        var origRot = src.getPage(p.srcIndex).getRotation().angle;
        copied.setRotation(PDFLib.degrees((origRot + p.rot) % 360));
        out.addPage(copied);
      }
      PG.setProgress(96, 'Saving organized PDF…');
      await PG.tick();
      var saved = await out.save({ useObjectStreams: true });
      PG.done(new Blob([saved], { type: 'application/pdf' }), 'organized.pdf',
        'Done! Your organized PDF has ' + pages.length + ' pages (' + PG.fileSize(saved.length) + ').');
    } catch (err) {
      PG.fail(err.message || 'Organize failed.');
      btn.disabled = false;
    }
  });

  buildWorkspace();
  PG.el('processBtn').disabled = true;
})();
