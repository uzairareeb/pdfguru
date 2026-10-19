/* PDFGuru — Compare PDF. Extract the text lines of two PDFs and diff them
   with a line-based LCS. Differences render on the page (pink = only in the
   first file, green = only in the second) and a text report downloads via
   PG.done. This page uses its own two dropzones (dzA/fileA, dzB/fileB). */
(function () {
  'use strict';

  var fileA = null;
  var fileB = null;
  var MAX_LINES = 4000;
  var MAX_RENDER = 1500;

  function setZoneLabel(zoneId, text) {
    var zone = PG.el(zoneId);
    if (!zone) return;
    var lab = zone.querySelector('.dz-label');
    if (!lab) {
      lab = document.createElement('div');
      lab.className = 'dz-label';
      lab.style.marginTop = '8px';
      lab.style.fontWeight = '600';
      zone.appendChild(lab);
    }
    lab.textContent = text;
  }

  function updateReady() {
    PG.el('processBtn').disabled = !(fileA && fileB);
  }

  // Extract ordered text lines from a PDF (pdf.js), prefixed with [pN] when multi-page.
  async function extractLines(bytes, tag, onProg) {
    var doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    var lines = [];
    var multi = doc.numPages > 1;
    for (var p = 1; p <= doc.numPages; p++) {
      if (onProg) onProg(p, doc.numPages);
      await PG.tick();
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      var items = tc.items.filter(function (it) { return it.str && it.str.trim(); });
      items.sort(function (a, b) {
        return (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]);
      });
      var pageLines = [];
      items.forEach(function (it) {
        var y = it.transform[5];
        var last = pageLines[pageLines.length - 1];
        if (last && Math.abs(last.y - y) < 4) {
          last.parts.push({ x: it.transform[4], s: it.str });
        } else {
          pageLines.push({ y: y, parts: [{ x: it.transform[4], s: it.str }] });
        }
      });
      pageLines.forEach(function (ln) {
        ln.parts.sort(function (a, b) { return a.x - b.x; });
        var t = ln.parts.map(function (q) { return q.s; }).join(' ').replace(/\s+/g, ' ').trim();
        if (t) lines.push((multi ? '[p' + p + '] ' : '') + t);
      });
    }
    if (typeof doc.destroy === 'function') { try { doc.destroy(); } catch (e) {} }
    return lines;
  }

  // LCS-based diff. Returns ops: {t:'same'|'del'|'ins', s}.
  function lcsDiff(a, b) {
    var n = a.length, m = b.length;
    var stride = m + 1;
    var dp = new Uint16Array((n + 1) * stride);
    for (var i = 1; i <= n; i++) {
      var ai = a[i - 1];
      for (var j = 1; j <= m; j++) {
        var idx = i * stride + j;
        if (ai === b[j - 1]) dp[idx] = dp[(i - 1) * stride + (j - 1)] + 1;
        else {
          var up = dp[(i - 1) * stride + j];
          var left = dp[i * stride + (j - 1)];
          dp[idx] = up >= left ? up : left;
        }
      }
    }
    var ops = [];
    var x = n, y = m;
    while (x > 0 && y > 0) {
      if (a[x - 1] === b[y - 1]) { ops.push({ t: 'same', s: a[x - 1] }); x--; y--; }
      else if (dp[(x - 1) * stride + y] >= dp[x * stride + (y - 1)]) { ops.push({ t: 'del', s: a[x - 1] }); x--; }
      else { ops.push({ t: 'ins', s: b[y - 1] }); y--; }
    }
    while (x > 0) { ops.push({ t: 'del', s: a[x - 1] }); x--; }
    while (y > 0) { ops.push({ t: 'ins', s: b[y - 1] }); y--; }
    ops.reverse();
    return ops;
  }

  function renderDiff(ops, note) {
    var box = PG.el('diffOutput');
    box.innerHTML = '';
    var dels = 0, inss = 0;
    ops.forEach(function (op) {
      if (op.t === 'del') dels++;
      else if (op.t === 'ins') inss++;
    });

    var head = document.createElement('div');
    head.style.margin = '12px 0';
    head.style.fontWeight = '600';
    head.textContent = dels + ' line(s) only in the first file, ' + inss + ' line(s) only in the second file.';
    box.appendChild(head);
    if (note) {
      var n = document.createElement('div');
      n.style.margin = '0 0 12px 0';
      n.style.fontSize = '13px';
      n.textContent = note;
      box.appendChild(n);
    }
    if (dels === 0 && inss === 0) {
      var same = document.createElement('div');
      same.textContent = 'No differences found \u2014 the extracted text is identical.';
      box.appendChild(same);
      return;
    }

    var list = document.createElement('div');
    list.style.fontFamily = 'monospace';
    list.style.fontSize = '13px';
    var shown = 0;
    for (var i = 0; i < ops.length && shown < MAX_RENDER; i++) {
      var op = ops[i];
      if (op.t === 'same') continue;
      var row = document.createElement('div');
      row.style.padding = '4px 8px';
      row.style.marginBottom = '2px';
      row.style.borderRadius = '4px';
      row.style.wordBreak = 'break-word';
      if (op.t === 'del') {
        row.style.background = '#fee2e2';
        row.textContent = '\u2212 ' + op.s;
      } else {
        row.style.background = '#dcfce7';
        row.textContent = '+ ' + op.s;
      }
      list.appendChild(row);
      shown++;
    }
    box.appendChild(list);
    if (shown < dels + inss) {
      var more = document.createElement('div');
      more.style.marginTop = '8px';
      more.style.fontSize = '13px';
      more.textContent = 'Showing ' + shown + ' of ' + (dels + inss) + ' differing lines. The full list is in the downloaded report.';
      box.appendChild(more);
    }
  }

  PG.bindDropzone({
    zoneId: 'dzA',
    inputId: 'fileA',
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      var f = list[0];
      if (!f || !PG.isPdf(f)) { PG.fail('Please choose a PDF file.'); return; }
      fileA = f;
      setZoneLabel('dzA', 'First file: ' + f.name + ' (' + PG.fileSize(f.size) + ')');
      updateReady();
    }
  });

  PG.bindDropzone({
    zoneId: 'dzB',
    inputId: 'fileB',
    accept: 'application/pdf,.pdf',
    multiple: false,
    onFiles: function (list) {
      var f = list[0];
      if (!f || !PG.isPdf(f)) { PG.fail('Please choose a PDF file.'); return; }
      fileB = f;
      setZoneLabel('dzB', 'Second file: ' + f.name + ' (' + PG.fileSize(f.size) + ')');
      updateReady();
    }
  });

  PG.el('processBtn').addEventListener('click', async function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      if (!fileA || !fileB) throw new Error('Choose both PDF files first.');
      PG.setProgress(10, 'Reading first file\u2026');
      await PG.tick();
      var bytesA = await PG.readAsArrayBuffer(fileA);
      var linesA = await extractLines(bytesA, 'A', function (p, total) {
        PG.setProgress(Math.round(10 + (p / total) * 30), 'Reading first file (page ' + p + '/' + total + ')\u2026');
      });
      PG.setProgress(45, 'Reading second file\u2026');
      await PG.tick();
      var bytesB = await PG.readAsArrayBuffer(fileB);
      var linesB = await extractLines(bytesB, 'B', function (p, total) {
        PG.setProgress(Math.round(45 + (p / total) * 30), 'Reading second file (page ' + p + '/' + total + ')\u2026');
      });

      var note = '';
      if (linesA.length > MAX_LINES || linesB.length > MAX_LINES) {
        note = 'Note: documents are long \u2014 only the first ' + MAX_LINES + ' lines of each were compared.';
        linesA = linesA.slice(0, MAX_LINES);
        linesB = linesB.slice(0, MAX_LINES);
      }

      PG.setProgress(80, 'Comparing text\u2026');
      await PG.tick();
      var ops = lcsDiff(linesA, linesB);
      renderDiff(ops, note);

      var dels = 0, inss = 0;
      var report = ['PDFGuru comparison report', 'First file:  ' + fileA.name, 'Second file: ' + fileB.name, ''];
      ops.forEach(function (op) {
        if (op.t === 'del') { dels++; report.push('- ' + op.s); }
        else if (op.t === 'ins') { inss++; report.push('+ ' + op.s); }
      });
      report.unshift('');
      report.unshift('Differences: ' + dels + ' line(s) only in first file, ' + inss + ' line(s) only in second file.');
      if (note) report.push('', note);

      PG.done(
        new Blob([report.join('\n')], { type: 'text/plain' }),
        'comparison.txt',
        'Compared ' + linesA.length + ' vs ' + linesB.length + ' text lines: ' +
          dels + ' only in the first file, ' + inss + ' only in the second.'
      );
    } catch (err) {
      PG.fail(err.message || 'Comparison failed.');
      btn.disabled = false;
    }
  });

  updateReady();
})();
