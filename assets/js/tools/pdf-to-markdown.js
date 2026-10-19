/* PDFGuru — PDF to Markdown. Extracts page text with simple heading detection. */
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

  // Groups text items into lines, keeping each line's average font size.
  function textLinesWithSize(items) {
    var buckets = {};
    items.forEach(function (item) {
      var y = Math.round(item.transform[5]);
      var key = 'y' + y;
      if (!buckets[key]) buckets[key] = { y: y, parts: [], sizes: [] };
      buckets[key].parts.push(item.str);
      // transform[0] is the horizontal font scale ~ font size.
      buckets[key].sizes.push(Math.abs(item.transform[0]));
    });
    var keys = Object.keys(buckets);
    keys.sort(function (a, b) { return buckets[b].y - buckets[a].y; });
    return keys.map(function (k) {
      var b = buckets[k];
      var avg = b.sizes.reduce(function (s, v) { return s + v; }, 0) / b.sizes.length;
      return {
        text: b.parts.join(' ').replace(/\s+/g, ' ').trim(),
        size: avg
      };
    }).filter(function (l) { return l.text.length > 0; });
  }

  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function escapeLine(text) {
    // Escape leading markdown-special characters minimally.
    return text
      .replace(/^(\s*)(#{1,6}\s)/, '$1\\$2')
      .replace(/^(\s*)([-*+]\s)/, '$1\\$2')
      .replace(/^(\s*)(\d+\.\s)/, '$1\\$2');
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
      var detectHeadings = PG.el('mdHeadings') ? PG.el('mdHeadings').checked : true;

      var bytes = await PG.readAsArrayBuffer(file);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

      var pagesMd = [];
      var totalLines = 0;
      for (var p = 1; p <= pdf.numPages; p++) {
        PG.setProgress(Math.round(((p - 1) / pdf.numPages) * 95), 'Reading page ' + p + ' of ' + pdf.numPages + '…');
        await PG.tick();
        var page = await pdf.getPage(p);
        var content = await page.getTextContent();
        var lines = textLinesWithSize(content.items);
        totalLines += lines.length;
        var med = lines.length ? median(lines.map(function (l) { return l.size; })) : 0;
        var md = lines.map(function (l) {
          var t = escapeLine(l.text);
          if (detectHeadings && med > 0 && l.size > med * 1.25 && l.text.length < 120) {
            return '## ' + t;
          }
          return t;
        }).join('\n\n');
        pagesMd.push(md);
      }
      if (!totalLines) throw new Error('No readable text was found in this PDF. It may be a scanned document.');

      var markdown = pagesMd.join('\n\n---\n\n');
      var blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      PG.done(blob, 'document.md',
        'Done! Text from ' + pdf.numPages + ' page(s) saved as Markdown in document.md (' +
        PG.fileSize(blob.size) + ').' + (detectHeadings ? ' Larger lines were marked as headings.' : ''));
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
