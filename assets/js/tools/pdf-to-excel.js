/* PDFGuru — PDF to Excel. Extracts page text lines into spreadsheet rows. */
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
      if (typeof XLSX === 'undefined') throw new Error('The spreadsheet library failed to load. Please reload the page.');

      var bytes = await PG.readAsArrayBuffer(file);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

      var wb = XLSX.utils.book_new();
      var totalRows = 0;
      for (var p = 1; p <= pdf.numPages; p++) {
        PG.setProgress(Math.round(((p - 1) / pdf.numPages) * 90), 'Reading page ' + p + ' of ' + pdf.numPages + '…');
        await PG.tick();
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        var lines = textLines(content.items);
        var rows = lines.map(function (line) {
          return line.split(/\s{2,}|\t/).map(function (c) { return c.trim(); });
        });
        totalRows += rows.length;
        var sheet = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['(no text on this page)']]);
        XLSX.utils.book_append_sheet(wb, sheet, 'Page ' + p);
      }
      if (!totalRows) throw new Error('No readable text was found in this PDF. It may be a scanned document.');

      PG.setProgress(96, 'Building spreadsheet…');
      await PG.tick();
      var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      PG.done(blob, 'table.xlsx',
        'Done! Text-based extraction from ' + pdf.numPages + ' page(s) saved as table.xlsx (' +
        PG.fileSize(blob.size) + '). One sheet per page; cells are split on wide gaps, so review merged columns.');
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
