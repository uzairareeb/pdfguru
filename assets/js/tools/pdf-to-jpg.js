/* PDFGuru — PDF to JPG. Renders PDF pages to images, packs them into a ZIP. */
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

  // Parse "1-3" (1-based, inclusive) into zero-based indices; blank => all pages.
  function pageIndices(text, total) {
    var t = (text || '').trim();
    if (!t) {
      var all = [];
      for (var i = 0; i < total; i++) all.push(i);
      return all;
    }
    var m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) throw new Error('Page range must look like "1-3" (or leave blank for all pages).');
    var start = parseInt(m[1], 10), end = parseInt(m[2], 10);
    if (start < 1 || end > total || start > end)
      throw new Error('Page range must be within 1–' + total + '.');
    var out = [];
    for (var i = start - 1; i < end; i++) out.push(i);
    return out;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b);
        else reject(new Error('Could not encode the page image.'));
      }, mime, quality);
    });
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
      var format = PG.el('formatSelect') ? PG.el('formatSelect').value : 'jpeg';
      var scale = parseFloat(PG.el('scaleSelect') ? PG.el('scaleSelect').value : '1') || 1;
      var mime = format === 'png' ? 'image/png' : 'image/jpeg';
      var ext = format === 'png' ? 'png' : 'jpg';

      var bytes = await PG.readAsArrayBuffer(file);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      var indices = pageIndices(PG.el('jpgRange') ? PG.el('jpgRange').value : '', pdf.numPages);
      if (!indices.length) throw new Error('No pages to convert.');

      var zip = new JSZip();
      for (var i = 0; i < indices.length; i++) {
        var p = indices[i];
        PG.setProgress(Math.round((i / indices.length) * 100),
          'Rendering page ' + (p + 1) + ' of ' + pdf.numPages + '…');
        await PG.tick();
        var page = await pdf.getPage(p + 1);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        var ctx = canvas.getContext('2d');
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var blob = await canvasToBlob(canvas, mime, 0.92);
        var num = ('0' + (p + 1)).slice(-2);
        zip.file('page-' + num + '.' + ext, blob);
      }
      PG.setProgress(98, 'Creating ZIP…');
      await PG.tick();
      var zipBlob = await zip.generateAsync({ type: 'blob' });
      PG.done(zipBlob, 'pages.zip',
        'Done! ' + indices.length + ' page(s) saved as ' + ext.toUpperCase() +
        ' images inside pages.zip (' + PG.fileSize(zipBlob.size) + ').');
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
