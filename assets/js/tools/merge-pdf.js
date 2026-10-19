/* PDFGuru — Merge PDF. REFERENCE IMPLEMENTATION for all tool scripts.
   Contract: IIFE, 'use strict', PG helpers from app.js, standard DOM ids.
   Flow: bind dropzone -> collect files -> render list w/ reorder -> process on click. */
(function () {
  'use strict';

  var files = [];

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

      var up = document.createElement('button');
      up.className = 'mini-btn'; up.textContent = '↑'; up.title = 'Move up';
      up.addEventListener('click', function () {
        if (i > 0) { var t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; renderList(); }
      });
      var down = document.createElement('button');
      down.className = 'mini-btn'; down.textContent = '↓'; down.title = 'Move down';
      down.addEventListener('click', function () {
        if (i < files.length - 1) { var t = files[i + 1]; files[i + 1] = files[i]; files[i] = t; renderList(); }
      });
      var del = document.createElement('button');
      del.className = 'mini-btn danger'; del.textContent = '✕'; del.title = 'Remove';
      del.addEventListener('click', function () { files.splice(i, 1); renderList(); });
      row.appendChild(up); row.appendChild(down); row.appendChild(del);
      list.appendChild(row);
    });
    PG.el('processBtn').disabled = files.length < 2;
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
      var out = await PDFLib.PDFDocument.create();
      var totalPages = 0;
      for (var i = 0; i < files.length; i++) {
        PG.setProgress(Math.round((i / files.length) * 90), 'Merging file ' + (i + 1) + ' of ' + files.length + '…');
        await PG.tick();
        var bytes = await PG.readAsArrayBuffer(files[i]);
        var src;
        try {
          src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
        } catch (e) {
          throw new Error('"' + files[i].name + '" could not be opened. It may be password protected or damaged.');
        }
        var pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(function (p) { out.addPage(p); totalPages++; });
      }
      PG.setProgress(96, 'Saving merged PDF…');
      await PG.tick();
      var merged = await out.save({ useObjectStreams: true });
      PG.done(
        new Blob([merged], { type: 'application/pdf' }),
        'merged.pdf',
        'Done! ' + files.length + ' PDFs merged into one file with ' + totalPages + ' pages (' + PG.fileSize(merged.length) + ').'
      );
    } catch (err) {
      PG.fail(err.message || 'Merge failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
