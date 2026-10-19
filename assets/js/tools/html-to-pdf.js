/* PDFGuru — HTML to PDF. Prints the pasted HTML through the browser print dialog. */
(function () {
  'use strict';

  function looksLikeHtml(text) {
    return /<[a-zA-Z][^>]*>/i.test(text);
  }

  function escapeText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function buildDocument(raw) {
    if (/<\s*html[\s>]/i.test(raw)) return raw; // full document already
    var body = looksLikeHtml(raw) ? raw : escapeText(raw);
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>PDFGuru print</title>' +
      '<style>body{font-family:Arial,Helvetica,sans-serif;margin:24px;line-height:1.5;}' +
      'img{max-width:100%;height:auto;}</style>' +
      '</head><body>' + body + '</body></html>';
  }

  PG.el('processBtn').addEventListener('click', function () {
    PG.resetWork();
    var btn = PG.el('processBtn');
    btn.disabled = true;
    try {
      var input = PG.el('htmlInput');
      var raw = input ? input.value.trim() : '';
      if (!raw) throw new Error('Paste some HTML (or plain text) into the box first.');

      var docHtml = buildDocument(raw);

      var iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-10000px';
      iframe.style.top = '0';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      document.body.appendChild(iframe);

      var iwin = iframe.contentWindow;
      iwin.document.open();
      iwin.document.write(docHtml);
      iwin.document.close();

      var cleanedUp = false;
      function cleanup() {
        if (cleanedUp) return;
        cleanedUp = true;
        setTimeout(function () {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1000);
      }
      iwin.onafterprint = cleanup;
      setTimeout(cleanup, 120000); // safety net

      // Focus is required by some browsers before print().
      setTimeout(function () {
        iwin.focus();
        iwin.print();
      }, 250);

      var wrap = PG.el('progressWrap');
      if (wrap) wrap.hidden = true;
      var r = PG.el('resultArea');
      if (r) r.hidden = false;
      var dl = PG.el('downloadBtn');
      if (dl) dl.style.display = 'none';
      var info = PG.el('resultInfo');
      if (info) info.textContent = 'The print dialog should open now. Use its "Save as PDF" destination to create your PDF.';
      btn.disabled = false;
      if (r) r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      PG.fail(err.message || 'Could not start printing.');
      btn.disabled = false;
    }
  });
})();
