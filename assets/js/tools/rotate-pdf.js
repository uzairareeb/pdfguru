/* PDFGuru — Rotate PDF. Rotate all or selected pages of one or more PDFs by 90°/180°/270°.
   Contract: IIFE, 'use strict', PG helpers from app.js, standard DOM ids.
   Options: select#angleSelect (90/180/270), radio name="pageScope" (values "all"/"range"),
   input#pageRange (e.g. "2-5"). */
(function () {
  'use strict';

  var files = [];

  // Parse "2-5, 8" -> sorted unique 1-based page numbers within [1, pageCount]. Null if invalid.
  function parsePages(text, pageCount) {
    var parts = String(text || '').split(',');
    var seen = {};
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var m = p.match(/^(\d+)\s*-\s*(\d+)$/);
      var a, b;
      if (m) { a = parseInt(m[1], 10); b = parseInt(m[2], 10); }
      else if (/^\d+$/.test(p)) { a = b = parseInt(p, 10); }
      else return null;
      if (a < 1 || b < a || b > pageCount) return null;
      for (var n = a; n <= b; n++) {
        if (!seen[n]) { seen[n] = true; out.push(n); }
      }
    }
    if (!out.length) return null;
    out.sort(function (x, y) { return x - y; });
    return out;
  }

  function getAngle() {
    var s = PG.el('angleSelect');
    var a = s ? parseInt(s.value, 10) : 90;
    return (a === 90 || a === 180 || a === 270) ? a : 90;
  }

  function getScope() {
    var sel = document.querySelector('input[name="pageScope"]:checked');
    return sel ? sel.value : 'all';
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
      row.appendChild(name);
      row.appendChild(size);
      var del = document.createElement('button');
      del.className = 'mini-btn danger';
      del.textContent = '✕';
      del.title = 'Remove';
      del.addEventListener('click', function () { files.splice(i, 1); renderList(); });
      row.appendChild(del);
      list.appendChild(row);
    });
    PG.el('processBtn').disabled = files.length < 1;
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
    if (!files.length) { PG.fail('Please add at least one PDF file.'); return; }
    var angle = getAngle();
    var scope = getScope();
    var rangeText = PG.el('pageRange') ? PG.el('pageRange').value : '';
    btn.disabled = true;
    try {
      var outputs = [];
      for (var i = 0; i < files.length; i++) {
        PG.setProgress(Math.round((i / files.length) * 90),
          'Rotating file ' + (i + 1) + ' of ' + files.length + '…');
        await PG.tick();
        var bytes = await PG.readAsArrayBuffer(files[i]);
        var doc;
        try {
          doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
        } catch (e) {
          throw new Error('"' + files[i].name + '" could not be opened. It may be password protected or damaged.');
        }
        var pageCount = doc.getPageCount();
        var targets = [];
        if (scope === 'range') {
          var parsed = parsePages(rangeText, pageCount);
          if (!parsed) {
            throw new Error('Invalid page range for "' + files[i].name + '". Use a format like "2-5, 8" with pages between 1 and ' + pageCount + '.');
          }
          targets = parsed.map(function (n) { return n - 1; });
        } else {
          for (var p = 0; p < pageCount; p++) targets.push(p);
        }
        targets.forEach(function (pi) {
          var page = doc.getPage(pi);
          var cur = page.getRotation().angle;
          page.setRotation(PDFLib.degrees((cur + angle) % 360));
        });
        var saved = await doc.save({ useObjectStreams: true });
        outputs.push({ name: 'rotated-' + files[i].name, orig: files[i].name, bytes: saved, count: targets.length });
      }
      PG.setProgress(95, 'Finishing…');
      await PG.tick();
      if (outputs.length === 1) {
        var o = outputs[0];
        PG.done(new Blob([o.bytes], { type: 'application/pdf' }), o.name,
          'Done! Rotated ' + o.count + ' page' + (o.count > 1 ? 's' : '') +
          ' by ' + angle + '° in "' + o.orig + '" (' + PG.fileSize(o.bytes.length) + ').');
      } else {
        var zip = new JSZip();
        outputs.forEach(function (x) { zip.file(x.name, x.bytes); });
        var zipBlob = await zip.generateAsync({ type: 'blob' });
        var totalPages = outputs.reduce(function (sum, x) { return sum + x.count; }, 0);
        PG.done(zipBlob, 'rotated-pdfs.zip',
          'Done! ' + outputs.length + ' PDFs rotated by ' + angle + '° (' + totalPages + ' pages) and packed into rotated-pdfs.zip.');
      }
    } catch (err) {
      PG.fail(err.message || 'Rotate failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
