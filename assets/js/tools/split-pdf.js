/* PDFGuru — Split PDF. Split a PDF into multiple PDFs by page ranges, or one PDF per page.
   Contract: IIFE, 'use strict', PG helpers from app.js, standard DOM ids.
   Options: radio name="splitMode" (values "ranges"/"each"), input#rangesInput (e.g. "1-3, 5, 8-10"). */
(function () {
  'use strict';

  var files = [];

  // Parse "1-3, 5, 8-10" -> [[1,3],[5,5],[8,10]] (1-based). Returns null on invalid input.
  function parseRanges(text, pageCount) {
    var parts = String(text || '').split(',');
    var ranges = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var m = p.match(/^(\d+)\s*-\s*(\d+)$/);
      var a, b;
      if (m) { a = parseInt(m[1], 10); b = parseInt(m[2], 10); }
      else if (/^\d+$/.test(p)) { a = b = parseInt(p, 10); }
      else return null;
      if (a < 1 || b < a || b > pageCount) return null;
      ranges.push([a, b]);
    }
    return ranges.length ? ranges : null;
  }

  function getMode() {
    var sel = document.querySelector('input[name="splitMode"]:checked');
    return sel ? sel.value : 'ranges';
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
      var bytes = await PG.readAsArrayBuffer(file);
      var src;
      try {
        src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      } catch (e) {
        throw new Error('"' + file.name + '" could not be opened. It may be password protected or damaged.');
      }
      var pageCount = src.getPageCount();
      var mode = getMode();
      var ranges = [];
      if (mode === 'each') {
        if (pageCount > 60) {
          PG.fail('This PDF has ' + pageCount + ' pages — one file per page would be a very heavy download. Please use "Ranges" mode instead (e.g. "1-20, 21-40").');
          return;
        }
        for (var n = 1; n <= pageCount; n++) ranges.push([n, n]);
      } else {
        var input = PG.el('rangesInput');
        var parsed = parseRanges(input ? input.value : '', pageCount);
        if (!parsed) {
          PG.fail('Could not understand the page ranges. Use a format like "1-3, 5, 8-10" — every page must be between 1 and ' + pageCount + '.');
          return;
        }
        ranges = parsed;
      }

      btn.disabled = true;
      var zip = new JSZip();
      for (var i = 0; i < ranges.length; i++) {
        var a = ranges[i][0], b = ranges[i][1];
        var label = (a === b) ? String(a) : (a + '-' + b);
        PG.setProgress(Math.round((i / ranges.length) * 90),
          'Building split_' + label + '.pdf (' + (i + 1) + ' of ' + ranges.length + ')…');
        await PG.tick();
        var idx = [];
        for (var p = a; p <= b; p++) idx.push(p - 1);
        var part = await PDFLib.PDFDocument.create();
        var copied = await part.copyPages(src, idx);
        copied.forEach(function (pg) { part.addPage(pg); });
        var saved = await part.save({ useObjectStreams: true });
        zip.file('split_' + label + '.pdf', saved);
      }
      PG.setProgress(95, 'Packing ZIP file…');
      await PG.tick();
      var zipBlob = await zip.generateAsync({ type: 'blob' });
      PG.done(zipBlob, 'split-pages.zip',
        'Done! ' + ranges.length + ' PDF' + (ranges.length > 1 ? 's' : '') +
        ' created from "' + file.name + '" (' + pageCount + ' pages) and packed into split-pages.zip.');
    } catch (err) {
      PG.fail(err.message || 'Split failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
