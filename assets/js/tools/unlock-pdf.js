/* PDFGuru — Unlock PDF. Remove the open password from a PDF by loading it
   with pdf-lib using the supplied password and saving a fresh, unencrypted
   copy. Only works for the user/open password (not the owner/permissions
   password on its own), and only if the password is correct. */
(function () {
  'use strict';

  var file = null;

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
    var del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = '\u2715';
    del.title = 'Remove';
    del.addEventListener('click', function () {
      file = null;
      list.innerHTML = '';
      PG.el('processBtn').disabled = true;
    });
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(del);
    list.appendChild(row);
  }

  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      var f = list[0];
      if (!f || !PG.isPdf(f)) { PG.fail('Please add a PDF file.'); return; }
      file = f;
      PG.resetWork();
      renderFileRow();
      PG.el('processBtn').disabled = false;
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('Choose a PDF file first.');
      var password = (PG.el('pdfPassword').value || '');
      if (!password) throw new Error('Enter the PDF password first.');
      PG.setProgress(30, 'Unlocking\u2026');
      await PG.tick();
      var bytes = await PG.readAsArrayBuffer(file);
      var doc;
      try {
        doc = await PDFLib.PDFDocument.load(bytes, { password: password });
      } catch (e) {
        throw new Error('Wrong password or the file is damaged.');
      }
      PG.setProgress(70, 'Saving unlocked copy\u2026');
      await PG.tick();
      var saved = await doc.save();
      PG.done(
        new Blob([saved], { type: 'application/pdf' }),
        'unlocked-' + file.name,
        'Done! Your PDF is unlocked (' + PG.fileSize(saved.length) + ').'
      );
    } catch (err) {
      PG.fail(err.message || 'Unlock failed.');
      btn.disabled = false;
    }
  });

  PG.el('processBtn').disabled = true;
})();
