/* PDFGuru — Edit PDF. Place text, image and shape annotations on a page
   preview (drag to move, x to remove); they are replayed onto the PDF with
   pdf-lib when you download. Coordinates are stored as % (origin top-left)
   so the preview scale never matters. */
(function () {
  'use strict';

  var file = null;
  var fileBytes = null;
  var pdfDoc = null;
  var pageCount = 0;
  var annots = [];
  var nextId = 1;
  var annotImg = null; // { dataUrl, bytes, kind: 'png' | 'jpg' }

  var PREVIEW_W = 720;

  function hexToRgb(hex) {
    var h = String(hex || '#4338ca').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0x4338ca;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

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
    annots = [];
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
    annots.forEach(function (a) {
      if (a.page === curPage()) wrap.appendChild(buildOverlay(a));
    });
  }

  function enableDrag(d, a) {
    d.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest && ev.target.closest('.annot-x')) return;
      ev.preventDefault();
      var wrap = PG.el('stageWrap');
      var rect = wrap.getBoundingClientRect();
      var startX = ev.clientX, startY = ev.clientY;
      var origX = a.xPct, origY = a.yPct;
      function onMove(e2) {
        a.xPct = Math.min(96, Math.max(0, origX + ((e2.clientX - startX) / rect.width) * 100));
        a.yPct = Math.min(96, Math.max(0, origY + ((e2.clientY - startY) / rect.height) * 100));
        d.style.left = a.xPct + '%';
        d.style.top = a.yPct + '%';
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function buildOverlay(a) {
    var d = document.createElement('div');
    d.className = 'annot';
    d.setAttribute('data-id', a.id);
    d.style.position = 'absolute';
    d.style.left = a.xPct + '%';
    d.style.top = a.yPct + '%';
    d.style.cursor = 'move';
    d.style.zIndex = '5';
    if (a.type === 'text') {
      d.textContent = a.text;
      d.style.color = a.color;
      d.style.fontSize = Math.max(8, Math.round(a.size * 0.75)) + 'px';
      d.style.fontFamily = 'Helvetica, Arial, sans-serif';
      d.style.whiteSpace = 'nowrap';
      d.style.lineHeight = '1.1';
    } else if (a.type === 'image') {
      d.style.width = a.imgWPct + '%';
      var img = document.createElement('img');
      img.src = a.imgDataUrl;
      img.alt = '';
      img.draggable = false;
      img.style.width = '100%';
      img.style.display = 'block';
      d.appendChild(img);
    } else { // shape
      d.style.width = '25%';
      d.style.aspectRatio = '25 / 10';
      d.style.border = '2px solid #4338ca';
      d.style.boxSizing = 'border-box';
    }
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
      annots = annots.filter(function (it) { return it.id !== a.id; });
      if (d.parentNode) d.parentNode.removeChild(d);
    });
    d.appendChild(x);
    enableDrag(d, a);
    return d;
  }

  function onStageClick(ev) {
    if (ev.target.closest && ev.target.closest('.annot')) return;
    var wrap = PG.el('stageWrap');
    var rect = wrap.getBoundingClientRect();
    var xPct = ((ev.clientX - rect.left) / rect.width) * 100;
    var yPct = ((ev.clientY - rect.top) / rect.height) * 100;
    var type = PG.el('annotType').value;
    var a = { id: nextId++, type: type, page: curPage(), xPct: xPct, yPct: yPct };
    if (type === 'text') {
      var t = (PG.el('annotText').value || '').trim();
      if (!t) { PG.fail('Type the text to place first.'); return; }
      a.text = t;
      a.size = parseInt(PG.el('annotSize').value, 10) || 18;
      a.color = PG.el('annotColor').value || '#4338ca';
    } else if (type === 'image') {
      if (!annotImg) { PG.fail('Choose an image to place first.'); return; }
      a.imgDataUrl = annotImg.dataUrl;
      a.imgWPct = parseFloat(PG.el('annotImgW').value) || 30;
    }
    annots.push(a);
    wrap.appendChild(buildOverlay(a));
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

  var imgInput = PG.el('annotImage');
  if (imgInput) imgInput.addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (!PG.isImage(f)) { PG.fail('Please choose an image file.'); this.value = ''; return; }
    var r = new FileReader();
    r.onload = function () {
      annotImg = {
        dataUrl: r.result,
        bytes: dataUrlToBytes(r.result),
        kind: (/png/i.test(f.type) || /\.png$/i.test(f.name)) ? 'png' : 'jpg'
      };
    };
    r.readAsDataURL(f);
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('Choose a PDF file first.');
      if (!annots.length) throw new Error('Place at least one item on the preview first.');
      var out = await PDFLib.PDFDocument.load(fileBytes.slice(0), { ignoreEncryption: true });
      var font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
      var pages = out.getPages();
      var embeddedImg = null;
      var needImg = annots.some(function (a) { return a.type === 'image'; });
      if (needImg) {
        if (!annotImg) throw new Error('The placed image could not be read. Please choose it again.');
        embeddedImg = annotImg.kind === 'png'
          ? await out.embedPng(annotImg.bytes)
          : await out.embedJpg(annotImg.bytes);
      }
      for (var i = 0; i < annots.length; i++) {
        PG.setProgress(Math.round((i / annots.length) * 90), 'Placing item ' + (i + 1) + ' of ' + annots.length + '\u2026');
        await PG.tick();
        var a = annots[i];
        var pg = pages[a.page - 1];
        if (!pg) continue;
        var W = pg.getWidth(), H = pg.getHeight();
        if (a.type === 'text') {
          var c = hexToRgb(a.color);
          pg.drawText(a.text, {
            x: (a.xPct / 100) * W,
            y: H - (a.yPct / 100) * H - a.size,
            size: a.size,
            font: font,
            color: PDFLib.rgb(c.r, c.g, c.b)
          });
        } else if (a.type === 'image' && embeddedImg) {
          var dw = (a.imgWPct / 100) * W;
          var dh = dw * (embeddedImg.height / embeddedImg.width);
          pg.drawImage(embeddedImg, {
            x: (a.xPct / 100) * W,
            y: H - (a.yPct / 100) * H - dh,
            width: dw,
            height: dh
          });
        } else if (a.type === 'shape') {
          pg.drawRectangle({
            x: (a.xPct / 100) * W,
            y: H - ((a.yPct + 10) / 100) * H,
            width: 0.25 * W,
            height: 0.10 * H,
            borderColor: PDFLib.rgb(67 / 255, 56 / 255, 202 / 255),
            borderWidth: 2
          });
        }
      }
      PG.setProgress(96, 'Saving edited PDF\u2026');
      await PG.tick();
      var saved = await out.save();
      PG.done(
        new Blob([saved], { type: 'application/pdf' }),
        'edited-' + file.name,
        'Done! ' + annots.length + ' item(s) placed on your PDF (' + PG.fileSize(saved.length) + ').'
      );
    } catch (err) {
      PG.fail(err.message || 'Edit failed.');
      btn.disabled = false;
    }
  });

  PG.el('processBtn').disabled = true;
})();
