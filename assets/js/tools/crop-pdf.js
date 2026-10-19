/* PDFGuru — Crop PDF. Trim page margins by a fixed amount in points.
   Contract: IIFE, 'use strict', PG helpers from app.js, standard DOM ids.
   Options: inputs #mTop #mRight #mBottom #mLeft (points, default 0),
   radio name="cropScope" (values "all"/"range"), input#pageRange (e.g. "2-5"). */
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

  function getScope() {
    var sel = document.querySelector('input[name="cropScope"]:checked');
    return sel ? sel.value : 'all';
  }

  function getMargin(id) {
    var inp = PG.el(id);
    var v = inp ? parseFloat(inp.value) : 0;
    return v;
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
    multiple: false,
    onFiles: function (list) {
      files = [];
      list.forEach(function (f) { if (PG.isPdf(f)) files.push(f); });
      if (!files.length) PG.fail('Please add a PDF file.');
      renderList();
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    var file = files[0];
    if (!file) { PG.fail('Please add a PDF file first.'); return; }
    try {
      var mTop = getMargin('mTop');
      var mRight = getMargin('mRight');
      var mBottom = getMargin('mBottom');
      var mLeft = getMargin('mLeft');
      var margins = [mTop, mRight, mBottom, mLeft];
      for (var m = 0; m < margins.length; m++) {
        if (isNaN(margins[m]) || margins[m] < 0) {
          throw new Error('Margins must be numbers of 0 points or more.');
        }
      }

      var bytes = await PG.readAsArrayBuffer(file);
      var doc;
      try {
        doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      } catch (e) {
        throw new Error('"' + file.name + '" could not be opened. It may be password protected or damaged.');
      }
      var pageCount = doc.getPageCount();
      var scope = getScope();
      var targets = [];
      if (scope === 'range') {
        var parsed = parsePages(PG.el('pageRange') ? PG.el('pageRange').value : '', pageCount);
        if (!parsed) {
          throw new Error('Invalid page range. Use a format like "2-5, 8" with pages between 1 and ' + pageCount + '.');
        }
        targets = parsed.map(function (n) { return n - 1; });
      } else {
        for (var p = 0; p < pageCount; p++) targets.push(p);
      }

      btn.disabled = true;
      var skipped = 0;
      for (var i = 0; i < targets.length; i++) {
        PG.setProgress(Math.round((i / targets.length) * 90),
          'Cropping page ' + (i + 1) + ' of ' + targets.length + '…');
        await PG.tick();
        var page = doc.getPage(targets[i]);
        var size = page.getSize();
        if (mLeft + mRight >= size.width || mTop + mBottom >= size.height) { skipped++; continue; }
        page.node.set(
          PDFLib.PDFName.of('CropBox'),
          doc.context.obj([mLeft, mBottom, size.width - mLeft - mRight, size.height - mTop - mBottom])
        );
      }
      PG.setProgress(95, 'Saving cropped PDF…');
      await PG.tick();
      var saved = await doc.save({ useObjectStreams: true });
      var done = targets.length - skipped;
      var info = 'Done! Cropped ' + done + ' page' + (done !== 1 ? 's' : '') +
        ' — margins applied: top ' + mTop + 'pt, right ' + mRight + 'pt, bottom ' + mBottom + 'pt, left ' + mLeft + 'pt.';
      if (skipped) {
        info += ' ' + skipped + ' page' + (skipped > 1 ? 's were' : ' was') + ' skipped because the margins were larger than the page.';
      }
      PG.done(new Blob([saved], { type: 'application/pdf' }), 'cropped.pdf', info);
    } catch (err) {
      PG.fail(err.message || 'Crop failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
