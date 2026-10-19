/* PDFGuru — Watermark PDF. Stamp one or more PDFs with a text watermark
   (single centered or tiled grid) or an image watermark. Multiple files are
   returned as a ZIP (JSZip is lazy-loaded from CDN only in that case). */
(function () {
  'use strict';

  var files = [];
  var jsZipPromise = null;

  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve();
    if (jsZipPromise) return jsZipPromise;
    jsZipPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load the ZIP library. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return jsZipPromise;
  }

  function hexToRgb(hex) {
    var h = String(hex || '#888888').replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0x888888;
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.split(',')[1];
    var bin = atob(base64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

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
      var del = document.createElement('button');
      del.className = 'mini-btn danger';
      del.textContent = '\u2715';
      del.title = 'Remove';
      del.addEventListener('click', function () { files.splice(i, 1); renderList(); });
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(del);
      list.appendChild(row);
    });
    PG.el('processBtn').disabled = files.length < 1;
  }

  function wmMode() {
    var r = document.querySelector('input[name="wmType"]:checked');
    return r ? r.value : 'text';
  }

  function drawTextMark(page, font, text, cx, cy, size, color, opacity, rotate) {
    var w = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: cx - w / 2,
      y: cy - size / 2,
      size: size,
      font: font,
      color: color,
      opacity: opacity,
      rotate: PDFLib.degrees(rotate)
    });
  }

  async function watermarkOne(f, opts) {
    var bytes = await PG.readAsArrayBuffer(f);
    var doc;
    try {
      doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('"' + f.name + '" could not be opened. It may be password protected or damaged.');
    }
    var pages = doc.getPages();

    if (opts.mode === 'text') {
      var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      var color = hexToRgb(opts.color);
      for (var i = 0; i < pages.length; i++) {
        var pg = pages[i];
        var W = pg.getWidth(), H = pg.getHeight();
        if (opts.tiled) {
          for (var c = 0; c < 3; c++) {
            for (var r = 0; r < 4; r++) {
              drawTextMark(pg, font, opts.text, W * (c + 0.5) / 3, H * (r + 0.5) / 4,
                opts.size, color, opts.opacity, opts.rotate);
            }
          }
        } else {
          drawTextMark(pg, font, opts.text, W / 2, H / 2, opts.size, color, opts.opacity, opts.rotate);
        }
        await PG.tick();
      }
    } else {
      var emb = opts.imgKind === 'png' ? await doc.embedPng(opts.imgBytes) : await doc.embedJpg(opts.imgBytes);
      for (var j = 0; j < pages.length; j++) {
        var p2 = pages[j];
        var W2 = p2.getWidth(), H2 = p2.getHeight();
        var dw = 0.60 * W2;
        var dh = dw * (emb.height / emb.width);
        p2.drawImage(emb, {
          x: W2 / 2 - dw / 2,
          y: H2 / 2 - dh / 2,
          width: dw,
          height: dh,
          opacity: opts.opacity
        });
        await PG.tick();
      }
    }
    return doc.save();
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
      if (!files.length) throw new Error('Add at least one PDF first.');
      var mode = wmMode();
      var opts = {
        mode: mode,
        text: (PG.el('wmText').value || 'DRAFT'),
        opacity: Math.min(0.6, Math.max(0.1, parseFloat(PG.el('wmOpacity').value) || 0.25)),
        size: parseInt(PG.el('wmSize').value, 10) || 48,
        rotate: parseInt(PG.el('wmRotate').value, 10) || 0,
        color: PG.el('wmColor').value || '#888888',
        tiled: !!(PG.el('wmTiled') && PG.el('wmTiled').checked)
      };
      if (mode === 'image') {
        var imgFile = PG.el('wmImage').files && PG.el('wmImage').files[0];
        if (!imgFile || !PG.isImage(imgFile)) throw new Error('Choose a watermark image first.');
        var dataUrl = await new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function () { resolve(r.result); };
          r.onerror = function () { reject(new Error('Could not read the watermark image.')); };
          r.readAsDataURL(imgFile);
        });
        opts.imgBytes = dataUrlToBytes(dataUrl);
        opts.imgKind = (/png/i.test(imgFile.type) || /\.png$/i.test(imgFile.name)) ? 'png' : 'jpg';
      }

      var results = [];
      for (var i = 0; i < files.length; i++) {
        PG.setProgress(Math.round((i / files.length) * 90), 'Watermarking file ' + (i + 1) + ' of ' + files.length + '\u2026');
        await PG.tick();
        results.push({ name: files[i].name, bytes: await watermarkOne(files[i], opts) });
      }

      PG.setProgress(96, 'Preparing download\u2026');
      await PG.tick();
      if (results.length === 1) {
        var single = results[0];
        PG.done(
          new Blob([single.bytes], { type: 'application/pdf' }),
          'watermarked-' + single.name,
          'Done! Watermark applied (' + PG.fileSize(single.bytes.length) + ').'
        );
      } else {
        await ensureJSZip();
        var zip = new JSZip();
        results.forEach(function (r) { zip.file('watermarked-' + r.name, r.bytes); });
        var blob = await zip.generateAsync({ type: 'blob' });
        PG.done(blob, 'watermarked.zip',
          'Done! ' + results.length + ' watermarked PDFs packed into watermarked.zip (' + PG.fileSize(blob.size) + ').');
      }
    } catch (err) {
      PG.fail(err.message || 'Watermarking failed.');
      btn.disabled = false;
    }
  });

  renderList();
})();
