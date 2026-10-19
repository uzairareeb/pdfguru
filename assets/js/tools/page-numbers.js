/* PDFGuru — Page Numbers. Stamp page numbers onto one or more PDFs at a
   chosen corner/edge position with configurable start, format, size and
   margin. Multiple files are returned as a ZIP (JSZip lazy-loaded from CDN
   only in that case). */
(function () {
  'use strict';

  var files = [];
  var jsZipPromise = null;

  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve();
    if (jsZipPromise) return jsZipPromise;
    jsZipPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load the ZIP library. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return jsZipPromise;
  }

  function renderList() {
    var list = PG.el('fileList');
    list.innerHTML = '';
    files.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'file-row';
      var name = document.createElement('span');
      name.className = 'fname';
      name.textContent = (i + 1) + '. ' + f.name;
      var size = document.createElement('span');
      size.className = 'fsize';
      size.textContent = PG.fileSize(f.size);
      var del = document.createElement('button');
      del.className = 'mini-btn danger';
      del.textContent = '\u2715';
      del.title = 'Remove';
      del.addEventListener('click', function () { files.splice(i, 1); renderList(); });
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(del);
      list.appendChild(row);
    });
    PG.el('processBtn').disabled = files.length < 1;
  }

  function labelFor(n, total, format) {
    if (format === 'page-n') return 'Page ' + n;
    if (format === 'n-of-total') return n + ' of ' + total;
    return String(n);
  }

  async function numberOne(f, opts) {
    var bytes = await PG.readAsArrayBuffer(f);
    var doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('"' + f.name + '" could not be opened. It may be password protected or damaged.');
    }
    var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var pages = doc.getPages();
    var total = pages.length;
    var gray = PDFLib.rgb(0.25, 0.25, 0.25);
    for (var i = 0; i < total; i++) {
      var pg = pages[i];
      var W = pg.getWidth(), H = pg.getHeight();
      var n = opts.start + i;
      var text = labelFor(n, total, opts.format);
      var tw = font.widthOfTextAtSize(text, opts.size);
      var x = 0, y = 0;
      switch (opts.position) {
        case 'tl': x = opts.margin; y = H - opts.margin - opts.size; break;
        case 'tc': x = W / 2 - tw / 2; y = H - opts.margin - opts.size; break;
        case 'tr': x = W - opts.margin - tw; y = H - opts.margin - opts.size; break;
        case 'bl': x = opts.margin; y = opts.margin; break;
        case 'bc': x = W / 2 - tw / 2; y = opts.margin; break;
        case 'br': x = W - opts.margin - tw; y = opts.margin; break;
        default: x = W - opts.margin - tw; y = opts.margin;
      }
      pg.drawText(text, { x: x, y: y, size: opts.size, font: font, color: gray });
      await PG.tick();
    }
    return doc.save();
  }

  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: true,
    onFiles: function (list) {
      var added = 0;
      list.forEach(function (f) {
        if (PG.isPdf(f)) { files.push(f); added++; }
      });
      if (!added) PG.fail('Please add PDF files only.');
      renderList();
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!files.length) throw new Error('Add at least one PDF first.');
      var opts = {
        position: PG.el('pnPosition').value || 'br',
        start: parseInt(PG.el('pnStart').value, 10) || 1,
        format: PG.el('pnFormat').value || 'n',
        size: parseInt(PG.el('pnSize').value, 10) || 12,
        margin: parseFloat(PG.el('pnMargin').value)
      };
      if (isNaN(opts.margin)) opts.margin = 36;
      if (opts.size < 6) opts.size = 6;

      var results = [];
      for (var i = 0; i < files.length; i++) {
        PG.setProgress(Math.round((i / files.length) * 90), 'Numbering file ' + (i + 1) + ' of ' + files.length + '\u2026');
        await PG.tick();
        results.push({ name: files[i].name, bytes: await numberOne(files[i], opts) });
      }

      PG.setProgress(96, 'Preparing download\u2026');
      await PG.tick();
      if (results.length === 1) {
        var single = results[0];
        PG.done(
          new Blob([single.bytes], { type: 'application/pdf' }),
          'numbered-' + single.name,
          'Done! Page numbers added (' + PG.fileSize(single.bytes.length) + ').'
        );
      } else {
        await ensureJSZip();
        var zip = new JSZip();
        results.forEach(function (r) { zip.file('numbered-' + r.name, r.bytes); });
        var blob = await zip.generateAsync({ type: 'blob' });
        PG.done(blob, 'numbered.zip',
          'Done! ' + results.length + ' numbered PDFs packed into numbered.zip (' + PG.fileSize(blob.size) + ').');
      }
    } catch (err) {
      PG.fail(err.message || 'Numbering failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
