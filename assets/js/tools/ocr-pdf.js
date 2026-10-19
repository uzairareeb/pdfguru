/* PDFGuru — OCR PDF. Turn a scanned/image PDF into a searchable PDF:
   each page is rendered, run through Tesseract.js, then rebuilt with the
   page image plus an invisible (opacity 0) text layer so the text is
   selectable and searchable. Limited to 10 pages per run to keep runtime
   sane — use a page range for longer documents. */
(function () {
  'use strict';

  var file = null;
  var fileBytes = null;
  var pdfDoc = null;
  var pageCount = 0;
  var MAX_PAGES = 10;

  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.split(',')[1];
    var bin = atob(base64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function renderFileRow() {
    var list = PG.el('fileList');
    list.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'file-row';
    var name = document.createElement('span');
    name.className = 'fname';
    name.textContent = file.name + ' (' + pageCount + ' pages)';
    var size = document.createElement('span');
    size.className = 'fsize';
    size.textContent = PG.fileSize(file.size);
    row.appendChild(name);
    row.appendChild(size);
    list.appendChild(row);
  }

  async function loadFile(f) {
    file = f;
    fileBytes = await PG.readAsArrayBuffer(f);
    pdfDoc = await pdfjsLib.getDocument({ data: fileBytes.slice(0) }).promise;
    pageCount = pdfDoc.numPages;
    renderFileRow();
    PG.el('processBtn').disabled = false;
  }

  // "1-3" -> [1,2,3]; blank -> all pages.
  function parseRange(str, max) {
    str = (str || '').trim();
    var all = [];
    for (var i = 1; i <= max; i++) all.push(i);
    if (!str) return all;
    var m = str.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) throw new Error('Page range must look like "1-3". Leave it blank for all pages.');
    var a = Math.max(1, parseInt(m[1], 10));
    var b = Math.min(max, parseInt(m[2], 10));
    if (a > b) throw new Error('Invalid page range.');
    var out = [];
    for (var j = a; j <= b; j++) out.push(j);
    return out;
  }

  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      var f = list[0];
      if (!f || !PG.isPdf(f)) { PG.fail('Please add a PDF file.'); return; }
      PG.resetWork();
      loadFile(f).catch(function (err) { PG.fail(err.message || 'Could not open that PDF.'); });
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('Choose a PDF file first.');
      var lang = PG.el('ocrLang').value || 'eng';
      var pageNums = parseRange(PG.el('ocrRange').value, pageCount);
      if (pageNums.length > MAX_PAGES) {
        throw new Error('OCR is limited to ' + MAX_PAGES + ' pages per run. Enter a smaller range, e.g. "1-' + MAX_PAGES + '".');
      }

      var out = await PDFLib.PDFDocument.create();
      var font = await out.embedFont(PDFLib.StandardFonts.Helvetica);
      var SCALE = 2;

      for (var p = 0; p < pageNums.length; p++) {
        var n = pageNums[p];
        PG.setProgress(Math.round((p / pageNums.length) * 100), 'Rendering page ' + n + '\u2026');
        await PG.tick();

        var page = await pdfDoc.getPage(n);
        var v1 = page.getViewport({ scale: 1 });
        var W = v1.width, H = v1.height;
        var viewport = page.getViewport({ scale: SCALE });
        var canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;

        var self = p;
        var res = await Tesseract.recognize(canvas, lang, {
          logger: function (m) {
            if (m.status === 'recognizing text' && typeof m.progress === 'number') {
              var pct = Math.round(((self + m.progress) / pageNums.length) * 100);
              PG.setProgress(pct, 'Reading text on page ' + n + ' (' + Math.round(m.progress * 100) + '%)\u2026');
            }
          }
        });
        var words = (res && res.data && res.data.words) || [];

        var newPage = out.addPage([W, H]);
        var bg = await out.embedPng(dataUrlToBytes(canvas.toDataURL('image/png')));
        newPage.drawImage(bg, { x: 0, y: 0, width: W, height: H });

        var cw = canvas.width, ch = canvas.height;
        var placed = 0;
        for (var w = 0; w < words.length; w++) {
          var word = words[w];
          var text = (word.text || '').trim();
          if (!text || !word.bbox) continue;
          var bb = word.bbox;
          var fs = (bb.y1 - bb.y0) * (W / cw);
          if (fs < 2 || fs > H) continue;
          newPage.drawText(text, {
            x: (bb.x0 / cw) * W,
            y: H - (bb.y1 / ch) * H,
            size: fs,
            font: font,
            opacity: 0
          });
          placed++;
          if (placed % 200 === 0) await PG.tick();
        }
      }

      PG.setProgress(96, 'Saving searchable PDF\u2026');
      await PG.tick();
      var saved = await out.save();
      PG.done(
        new Blob([saved], { type: 'application/pdf' }),
        'searchable.pdf',
        'Done! ' + pageNums.length + ' page(s) are now searchable (' + PG.fileSize(saved.length) + ').'
      );
    } catch (err) {
      PG.fail(err.message || 'OCR failed.');
      btn.disabled = false;
    }
  });

  PG.el('processBtn').disabled = true;
})();
