/* PDFGuru — Summarize PDF. Extractive summary: the PDF's text is split into
   sentences, scored by word frequency (stopwords removed), and the top N
   sentences (in original order) render as a list and download as summary.txt. */
(function () {
  'use strict';

  var file = null;
  var fileBytes = null;

  var STOPWORDS = [
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'were', 'been',
    'are', 'was', 'will', 'would', 'there', 'their', 'what', 'which', 'when',
    'who', 'how', 'about', 'into', 'your', 'you', 'they', 'them', 'then',
    'than', 'also', 'such', 'can', 'not', 'but', 'its', 'our', 'has', 'had',
    'all', 'any', 'are', 'per', 'via', 'may', 'more', 'most', 'other', 'some'
  ];

  function isStop(w) {
    for (var i = 0; i < STOPWORDS.length; i++) {
      if (STOPWORDS[i] === w) return true;
    }
    return false;
  }

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
    row.appendChild(name);
    row.appendChild(size);
    list.appendChild(row);
  }

  async function loadFile(f) {
    file = f;
    fileBytes = await PG.readAsArrayBuffer(f);
    renderFileRow();
    PG.el('processBtn').disabled = false;
  }

  async function extractText(bytes) {
    var doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    var parts = [];
    for (var p = 1; p <= doc.numPages; p++) {
      PG.setProgress(Math.round((p / doc.numPages) * 40), 'Reading page ' + p + ' of ' + doc.numPages + '\u2026');
      await PG.tick();
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      var items = tc.items.filter(function (it) { return it.str && it.str.trim(); });
      items.sort(function (a, b) {
        return (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]);
      });
      var lines = [];
      items.forEach(function (it) {
        var y = it.transform[5];
        var last = lines[lines.length - 1];
        if (last && Math.abs(last.y - y) < 4) last.parts.push({ x: it.transform[4], s: it.str });
        else lines.push({ y: y, parts: [{ x: it.transform[4], s: it.str }] });
      });
      lines.forEach(function (ln) {
        ln.parts.sort(function (a, b) { return a.x - b.x; });
        var t = ln.parts.map(function (q) { return q.s; }).join(' ').replace(/\s+/g, ' ').trim();
        if (t) parts.push(t);
      });
    }
    if (typeof doc.destroy === 'function') { try { doc.destroy(); } catch (e) {} }
    return parts.join('\n');
  }

  function summarize(text, n) {
    var raw = text.match(/[^.!?]+[.!?]+/g) || [];
    var sentences = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i].replace(/\s+/g, ' ').trim();
      if (s.length > 20) sentences.push({ text: s, idx: i });
    }
    if (!sentences.length) return [];

    var freq = {};
    sentences.forEach(function (sn) {
      var words = sn.text.toLowerCase().match(/[a-z]{4,}/g) || [];
      words.forEach(function (w) {
        if (isStop(w)) return;
        freq[w] = (freq[w] || 0) + 1;
      });
    });

    sentences.forEach(function (sn) {
      var words = sn.text.toLowerCase().match(/[a-z]{4,}/g) || [];
      var sum = 0;
      words.forEach(function (w) {
        if (!isStop(w) && freq[w]) sum += freq[w];
      });
      var wc = sn.text.split(/\s+/).length || 1;
      sn.score = sum / Math.sqrt(wc);
    });

    var ranked = sentences.slice().sort(function (a, b) { return b.score - a.score; });
    var picked = ranked.slice(0, Math.min(n, ranked.length));
    picked.sort(function (a, b) { return a.idx - b.idx; });
    return picked;
  }

  function renderSummary(picked) {
    var box = PG.el('summaryOutput');
    box.innerHTML = '';
    if (!picked.length) {
      box.textContent = 'No sentences found in this PDF \u2014 it may be a scanned document. Try the OCR tool first.';
      return;
    }
    var ol = document.createElement('ol');
    ol.style.lineHeight = '1.7';
    picked.forEach(function (sn) {
      var li = document.createElement('li');
      li.style.marginBottom = '8px';
      li.textContent = sn.text;
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  PG.bindDropzone({
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      var f = list[0];
      if (!f || !PG.isPdf(f)) { PG.fail('Please add a PDF file.'); return; }
      PG.resetWork();
      loadFile(f).catch(function (err) { PG.fail(err.message || 'Could not read that PDF.'); });
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!file) throw new Error('Choose a PDF file first.');
      var n = parseInt(PG.el('sentCount').value, 10) || 5;

      var text = await extractText(fileBytes.slice(0));
      if (!text.trim()) throw new Error('No text found in this PDF. It may be a scanned document \u2014 try the OCR tool first.');

      PG.setProgress(60, 'Scoring sentences\u2026');
      await PG.tick();
      var picked = summarize(text, n);
      renderSummary(picked);

      PG.setProgress(90, 'Preparing download\u2026');
      await PG.tick();
      var report = [
        'PDFGuru summary of ' + file.name,
        'Top ' + picked.length + ' sentence(s), in original order:',
        ''
      ];
      picked.forEach(function (sn, i) { report.push((i + 1) + '. ' + sn.text); });

      PG.done(
        new Blob([report.join('\n')], { type: 'text/plain' }),
        'summary.txt',
        'Done! ' + picked.length + ' key sentence(s) extracted from ' + file.name + '.'
      );
    } catch (err) {
      PG.fail(err.message || 'Summarizing failed.');
      btn.disabled = false;
    }
  });

  PG.el('processBtn').disabled = true;
})();
