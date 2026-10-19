/* PDFGuru — Compress PDF. Re-save PDFs with object streams and (optionally) strip metadata.
   Contract: IIFE, 'use strict', PG helpers from app.js, standard DOM ids.
   Options: checkbox#stripMeta (checked by default). One file downloads directly, several are zipped. */
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
    var strip = PG.el('stripMeta') ? PG.el('stripMeta').checked : true;
    btn.disabled = true;
    try {
      var outputs = [];
      for (var i = 0; i < files.length; i++) {
        PG.setProgress(Math.round((i / files.length) * 90),
          'Compressing file ' + (i + 1) + ' of ' + files.length + '…');
        await PG.tick();
        var bytes = await PG.readAsArrayBuffer(files[i]);
        var src;
        try {
          src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false });
        } catch (e) {
          throw new Error('"' + files[i].name + '" could not be opened. It may be password protected or damaged.');
        }
        var out = await PDFLib.PDFDocument.create();
        var copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach(function (p) { out.addPage(p); });
        if (strip) {
          out.setTitle('');
          out.setAuthor('');
          out.setSubject('');
          out.setKeywords([]);
          out.setCreator('');
          out.setProducer('');
        }
        var saved = await out.save({ useObjectStreams: true });
        var before = bytes.byteLength;
        var after = saved.length;
        var pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
        var note = (after < before)
          ? (PG.fileSize(before) + ' → ' + PG.fileSize(after) + ' (' + pct + '% smaller)')
          : 'already well optimized — metadata stripped';
        outputs.push({ name: 'compressed-' + files[i].name, bytes: saved, note: note });
      }
      PG.setProgress(95, 'Finishing…');
      await PG.tick();
      var notes = outputs.map(function (o) { return o.name + ': ' + o.note; }).join(' ');
      if (outputs.length === 1) {
        PG.done(new Blob([outputs[0].bytes], { type: 'application/pdf' }), outputs[0].name,
          'Done! ' + notes);
      } else {
        var zip = new JSZip();
        outputs.forEach(function (o) { zip.file(o.name, o.bytes); });
        var zipBlob = await zip.generateAsync({ type: 'blob' });
        PG.done(zipBlob, 'compressed-pdfs.zip',
          'Done! ' + outputs.length + ' PDFs compressed. ' + notes);
      }
    } catch (err) {
      PG.fail(err.message || 'Compress failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
