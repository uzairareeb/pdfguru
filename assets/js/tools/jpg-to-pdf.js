/* PDFGuru — JPG to PDF. Combines images into a single PDF (shared core). */
(function () {
  'use strict';

  var files = [];
  var MM_TO_PT = 2.8346;
  var PX_TO_PT = 72 / 96;

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

  // Converts webp/gif/bmp to a PNG data URL via canvas.
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
      var pageSize = PG.el('pageSizeSelect') ? PG.el('pageSizeSelect').value : 'fit';
      var orientation = PG.el('orientationSelect') ? PG.el('orientationSelect').value : 'auto';
      var marginMm = parseFloat(PG.el('marginMm') ? PG.el('marginMm').value : '10');
      if (isNaN(marginMm) || marginMm < 0) marginMm = 10;
      var margin = marginMm * MM_TO_PT;

      var out = await PDFLib.PDFDocument.create();
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        PG.setProgress(Math.round((i / files.length) * 95), 'Adding image ' + (i + 1) + ' of ' + files.length + '…');
        await PG.tick();

        var img = await loadImage(f);
        var iw = img.naturalWidth || img.width;
        var ih = img.naturalHeight || img.height;

        // Embed natively when possible.
        var embedded, imgW, imgH;
        var type = (f.type || '').toLowerCase();
        if (type === 'image/jpeg' || /\.jpe?g$/i.test(f.name)) {
          var jpgBytes = await PG.readAsArrayBuffer(f);
          embedded = await out.embedJpg(jpgBytes);
        } else if (type === 'image/png' || /\.png$/i.test(f.name)) {
          var pngBytes = await PG.readAsArrayBuffer(f);
          embedded = await out.embedPng(pngBytes);
        } else {
          // webp / gif / bmp → rasterize to PNG
          var pngUrl = imageToPngDataUrl(img);
          embedded = await out.embedPng(pngUrl);
        }
        imgW = embedded.width;
        imgH = embedded.height;

        var pageW, pageH;
        if (pageSize === 'a4') { pageW = 595.28; pageH = 841.89; }
        else if (pageSize === 'letter') { pageW = 612; pageH = 792; }
        else { pageW = imgW * PX_TO_PT; pageH = imgH * PX_TO_PT; } // fit

        var orient = orientation;
        if (orient === 'auto' && pageSize !== 'fit') {
          orient = iw >= ih ? 'landscape' : 'portrait';
        }
        if (pageSize !== 'fit' && orient === 'landscape' && pageW < pageH) {
          var t = pageW; pageW = pageH; pageH = t;
        }
        if (pageSize !== 'fit' && orient === 'portrait' && pageW > pageH) {
          var t2 = pageW; pageW = pageH; pageH = t2;
        }

        var page = out.addPage([pageW, pageH]);
        var availW = pageW - margin * 2;
        var availH = pageH - margin * 2;
        var s = Math.min(availW / embedded.width, availH / embedded.height);
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
      PG.done(new Blob([pdfBytes], { type: 'application/pdf' }), 'images.pdf',
        'Done! ' + files.length + ' image(s) combined into images.pdf (' + PG.fileSize(pdfBytes.length) + ').');
    } catch (err) {
      PG.fail(err.message || 'Conversion failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
