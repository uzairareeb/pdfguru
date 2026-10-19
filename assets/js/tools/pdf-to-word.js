/* PDFGuru — PDF to Word. Extracts page text into a flowing .docx document. */
(function () {
  'use strict';

  var file = null;

  function renderList() {
    var list = PG.el('fileList');
    list.innerHTML = '';
    if (file) {
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
      var del = document.createElement('button');
      del.className = 'mini-btn danger'; del.textContent = '✕'; del.title = 'Remove';
      del.addEventListener('click', function () { file = null; renderList(); });
      row.appendChild(del);
      list.appendChild(row);
    }
    PG.el('processBtn').disabled = !file;
  }

  // Groups text items into visual lines by their Y position (transform[5]).
  function textLines(items) {
    var buckets = {};
    items.forEach(function (item) {
      var y = Math.round(item.transform[5]);
      var key = 'y' + y;
      if (!buckets[key]) buckets[key] = { y: y, parts: [] };
      buckets[key].parts.push(item.str);
    });
    var keys = Object.keys(buckets);
    // PDF Y grows upward: read top line first.
    keys.sort(function (a, b) { return buckets[b].y - buckets[a].y; });
    return keys.map(function (k) {
      return buckets[k].parts.join(' ').replace(/\s+/g, ' ').trim();
    }).filter(function (l) { return l.length > 0; });
  }

  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      if (list.length && PG.isPdf(list[0])) {
        file = list[0];
      } else {
        PG.fail('Please add a PDF file.');
      }
      renderList();
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('No PDF selected.');
      if (typeof docx === 'undefined') throw new Error('The Word library failed to load. Please reload the page.');

      var bytes = await PG.readAsArrayBuffer(file);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

      var paras = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        PG.setProgress(Math.round(((p - 1) / pdf.numPages) * 90), 'Reading page ' + p + ' of ' + pdf.numPages + '…');
        await PG.tick();
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        var lines = textLines(content.items);
        lines.forEach(function (line, li) {
          var para = new docx.Paragraph({
            children: [new docx.TextRun(line)]
          });
          if (p > 1 && li === 0) {
            // Start a new page for each PDF page after the first.
            para = new docx.Paragraph({
              pageBreakBefore: true,
              children: [new docx.TextRun(line)]
            });
          }
          paras.push(para);
        });
      }
      if (!paras.length) throw new Error('No readable text was found in this PDF. It may be a scanned document.');

      PG.setProgress(96, 'Building Word document…');
      await PG.tick();
      var doc = new docx.Document({ sections: [{ children: paras }] });
      var blob = await docx.Packer.toBlob(doc);
      PG.done(blob, 'document.docx',
        'Text-preserving conversion — complex layouts become flowing text. Saved document.docx (' +
        PG.fileSize(blob.size) + ').');
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
