/* PDFGuru — PDF to PowerPoint. Renders each PDF page as a full-slide image. */
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

  function canvasToDataUrl(canvas) {
    return canvas.toDataURL('image/png');
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
      if (typeof PptxGenJS === 'undefined') throw new Error('The PowerPoint library failed to load. Please reload the page.');

      var scaleEl = PG.el('pptScale');
      var scale = scaleEl ? parseFloat(scaleEl.value) : 1.5;
      if (!scale || scale <= 0) scale = 1.5;

      var bytes = await PG.readAsArrayBuffer(file);
      var pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'PDFPAGE', width: 13.33, height: 7.5 });
      pptx.layout = 'PDFPAGE';

      for (var p = 1; p <= pdf.numPages; p++) {
        PG.setProgress(Math.round(((p - 1) / pdf.numPages) * 92), 'Rendering page ' + p + ' of ' + pdf.numPages + '…');
        await PG.tick();
        var page = await pdf.getPage(p);
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        var dataUrl = canvasToDataUrl(canvas);
        var slide = pptx.addSlide();
        slide.addImage({ data: dataUrl, x: 0, y: 0, w: '100%', h: '100%' });
      }

      PG.setProgress(97, 'Building presentation…');
      await PG.tick();
      var blob = await pptx.write({ outputType: 'blob' });
      PG.done(blob, 'slides.pptx',
        'Done! ' + pdf.numPages + ' page(s) placed as full-slide images in slides.pptx (' +
        PG.fileSize(blob.size) + ').');
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
