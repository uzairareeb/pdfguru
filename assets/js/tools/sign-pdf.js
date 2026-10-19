/* PDFGuru — Sign PDF. Draw (or type) your signature on the signature pad,
   then click on the page preview to place it. Multiple placements allowed;
   the signature PNG is embedded once and stamped at each placement. */
(function () {
  'use strict';

  var file = null;
  var fileBytes = null;
  var pdfDoc = null;
  var pageCount = 0;
  var placements = [];
  var nextId = 1;

  var PREVIEW_W = 720;
  var PAD_W = 400, PAD_H = 160;

  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.split(',')[1];
    var bin = atob(base64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

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
      wrap.addEventListener('click', onStageClick);
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
    placements = [];
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
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    wrap.appendChild(canvas);
    placements.forEach(function (p) {
      if (p.page === curPage()) wrap.appendChild(buildOverlay(p));
    });
  }

  function enableDrag(d, p) {
    d.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest && ev.target.closest('.annot-x')) return;
      ev.preventDefault();
      var wrap = PG.el('stageWrap');
      var rect = wrap.getBoundingClientRect();
      var startX = ev.clientX, startY = ev.clientY;
      var origX = p.xPct, origY = p.yPct;
      function onMove(e2) {
        p.xPct = Math.min(96, Math.max(0, origX + ((e2.clientX - startX) / rect.width) * 100));
        p.yPct = Math.min(96, Math.max(0, origY + ((e2.clientY - startY) / rect.height) * 100));
        d.style.left = p.xPct + '%';
        d.style.top = p.yPct + '%';
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function buildOverlay(p) {
    var d = document.createElement('div');
    d.className = 'annot';
    d.style.position = 'absolute';
    d.style.left = p.xPct + '%';
    d.style.top = p.yPct + '%';
    d.style.width = p.wPct + '%';
    d.style.cursor = 'move';
    d.style.zIndex = '5';
    var img = document.createElement('img');
    img.src = p.dataUrl;
    img.alt = 'Signature';
    img.draggable = false;
    img.style.width = '100%';
    img.style.display = 'block';
    d.appendChild(img);
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'annot-x';
    x.textContent = '\u00d7';
    x.title = 'Remove';
    x.style.cssText = 'position:absolute;top:-12px;right:-12px;width:22px;height:22px;border-radius:50%;' +
      'border:none;background:#dc2626;color:#fff;font-size:14px;line-height:1;cursor:pointer;z-index:6;padding:0;';
    x.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    x.addEventListener('click', function (ev) {
      ev.stopPropagation();
      placements = placements.filter(function (it) { return it.id !== p.id; });
      if (d.parentNode) d.parentNode.removeChild(d);
    });
    d.appendChild(x);
    enableDrag(d, p);
    return d;
  }

  function padIsBlank() {
    var pad = PG.el('sigPad');
    var ctx = pad.getContext('2d');
    var data = ctx.getImageData(0, 0, pad.width, pad.height).data;
    for (var i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  }

  function onStageClick(ev) {
    if (ev.target.closest && ev.target.closest('.annot')) return;
    if (padIsBlank()) { PG.fail('Draw or type your signature on the pad first.'); return; }
    var wrap = PG.el('stageWrap');
    var rect = wrap.getBoundingClientRect();
    var p = {
      id: nextId++,
      page: curPage(),
      xPct: ((ev.clientX - rect.left) / rect.width) * 100,
      yPct: ((ev.clientY - rect.top) / rect.height) * 100,
      wPct: parseFloat(PG.el('sigW').value) || 25,
      dataUrl: PG.el('sigPad').toDataURL('image/png')
    };
    placements.push(p);
    wrap.appendChild(buildOverlay(p));
  }

  // ---- signature pad ----
  var pad = PG.el('sigPad');
  pad.width = PAD_W;
  pad.height = PAD_H;
  pad.style.touchAction = 'none';
  var ctx = pad.getContext('2d');
  var drawing = false, lastX = 0, lastY = 0;

  function padPos(ev) {
    var r = pad.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (pad.width / r.width),
      y: (ev.clientY - r.top) * (pad.height / r.height)
    };
  }

  pad.addEventListener('pointerdown', function (ev) {
    drawing = true;
    var p = padPos(ev);
    lastX = p.x; lastY = p.y;
    try { pad.setPointerCapture(ev.pointerId); } catch (e) {}
    ev.preventDefault();
  });
  pad.addEventListener('pointermove', function (ev) {
    if (!drawing) return;
    var p = padPos(ev);
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
    ev.preventDefault();
  });
  function stopDraw() { drawing = false; }
  pad.addEventListener('pointerup', stopDraw);
  pad.addEventListener('pointercancel', stopDraw);

  var clearBtn = PG.el('clearSigBtn');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    ctx.clearRect(0, 0, pad.width, pad.height);
  });

  var typedBtn = PG.el('useTypedBtn');
  if (typedBtn) typedBtn.addEventListener('click', function () {
    var t = (PG.el('typeSig').value || '').trim();
    if (!t) { PG.fail('Type your name first.'); return; }
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.fillStyle = '#1e3a8a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var size = 64;
    ctx.font = size + 'px "Brush Script MT", "Segoe Script", "Apple Chancery", cursive';
    var tw = ctx.measureText(t).width;
    if (tw > pad.width - 40) {
      size = Math.max(20, Math.floor(size * (pad.width - 40) / tw));
      ctx.font = size + 'px "Brush Script MT", "Segoe Script", "Apple Chancery", cursive';
    }
    ctx.fillText(t, pad.width / 2, pad.height / 2 + 4);
  });

  // ---- wiring ----
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

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('Choose a PDF file first.');
      if (!placements.length) throw new Error('Click on the preview to place your signature first.');
      var out = await PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true });
      var pages = out.getPages();
      var cache = {}; // dataUrl -> embedded image
      for (var i = 0; i < placements.length; i++) {
        PG.setProgress(Math.round((i / placements.length) * 90), 'Placing signature ' + (i + 1) + ' of ' + placements.length + '\u2026');
        await PG.tick();
        var p = placements[i];
        var pg = pages[p.page - 1];
        if (!pg) continue;
        var emb = cache[p.dataUrl];
        if (!emb) {
          emb = await out.embedPng(dataUrlToBytes(p.dataUrl));
          cache[p.dataUrl] = emb;
        }
        var W = pg.getWidth(), H = pg.getHeight();
        var dw = (p.wPct / 100) * W;
        var dh = dw * (emb.height / emb.width);
        pg.drawImage(emb, {
          x: (p.xPct / 100) * W,
          y: H - (p.yPct / 100) * H - dh,
          width: dw,
          height: dh
        });
      }
      PG.setProgress(96, 'Saving signed PDF\u2026');
      await PG.tick();
      var saved = await out.save();
      PG.done(
        new Blob([saved], { type: 'application/pdf' }),
        'signed.pdf',
        'Done! ' + placements.length + ' signature(s) stamped on your PDF (' + PG.fileSize(saved.length) + ').'
      );
    } catch (err) {
      PG.fail(err.message || 'Signing failed.');
      btn.disabled = false;
    }
  });

  PG.el('processBtn').disabled = true;
})();
