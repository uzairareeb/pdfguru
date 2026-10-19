/* PDFGuru — Scan to PDF. Combines captured/photo images into a single PDF. */
(function () {
  'use strict';

  var files = [];
  var MM_TO_PT = 2.8346;
  var PX_TO_PT = 72 / 96;
  var FIXED_MARGIN_MM = 10;

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
      del.className = 'mini-btn danger'; del.textContent = '✕'; del.title = 'Remove';
      del.addEventListener('click', function () { files.splice(i, 1); renderList(); });
      row.appendChild(del);
      list.appendChild(row);
    });
    PG.el('processBtn').disabled = files.length < 1;
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read image "' + file.name + '".')); };
      img.src = url;
    });
  }

  function imageToPngDataUrl(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  PG.bindDropzone({
    accept: 'image/*',
    multiple: true,
    onFiles: function (list) {
      var added = 0;
      list.forEach(function (f) {
        if (PG.isImage(f)) { files.push(f); added++; }
      });
      if (!added) PG.fail('Please add image files only.');
      renderList();
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!files.length) throw new Error('No images selected.');
      var pageSize = PG.el('scanSize') ? PG.el('scanSize').value : 'a4';
      var margin = FIXED_MARGIN_MM * MM_TO_PT;

      var out = await PDFLib.PDFDocument.create();
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        PG.setProgress(Math.round((i / files.length) * 95), 'Adding scan ' + (i + 1) + ' of ' + files.length + '…');
        await PG.tick();

        var img = await loadImage(f);
        var iw = img.naturalWidth || img.width;
        var ih = img.naturalHeight || img.height;

        var embedded;
        var type = (f.type || '').toLowerCase();
        if (type === 'image/jpeg' || /\.jpe?g$/i.test(f.name)) {
          embedded = await out.embedJpg(await PG.readAsArrayBuffer(f));
        } else if (type === 'image/png' || /\.png$/i.test(f.name)) {
          embedded = await out.embedPng(await PG.readAsArrayBuffer(f));
        } else {
          embedded = await out.embedPng(imageToPngDataUrl(img));
        }

        var pageW, pageH;
        if (pageSize === 'a4') { pageW = 595.28; pageH = 841.89; }
        else if (pageSize === 'letter') { pageW = 612; pageH = 792; }
        else { pageW = embedded.width * PX_TO_PT; pageH = embedded.height * PX_TO_PT; }

        // Scans read naturally in portrait; flip if the image is landscape and a fixed size is used.
        if (pageSize !== 'fit' && iw > ih && pageW < pageH) {
          var t = pageW; pageW = pageH; pageH = t;
        }

        var page = out.addPage([pageW, pageH]);
        var s = Math.min((pageW - margin * 2) / embedded.width, (pageH - margin * 2) / embedded.height);
        var drawW = embedded.width * s;
        var drawH = embedded.height * s;
        page.drawImage(embedded, {
          x: (pageW - drawW) / 2,
          y: (pageH - drawH) / 2,
          width: drawW,
          height: drawH
        });
      }
      PG.setProgress(98, 'Saving PDF…');
      await PG.tick();
      var pdfBytes = await out.save({ useObjectStreams: true });
      PG.done(new Blob([pdfBytes], { type: 'application/pdf' }), 'scan.pdf',
        'Done! ' + files.length + ' scan(s) combined into scan.pdf (' + PG.fileSize(pdfBytes.length) + ').');
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
