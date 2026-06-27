// Ledgrly public stats widget — drop into ledgrly.ie marketing pages.
//
// Usage:
//   <span data-ledgrly-stats></span>
//   <script src="/public-stats-widget.js"></script>
//
// Shows "X% of bookkeeping automated" when the gate passes, or a neutral
// on-brand line while below threshold. No counts, no placeholder numbers.

(function () {
  'use strict';

  var ENDPOINT    = 'https://app.ledgrly.ie/api/public-stats';
  var FALLBACK    = 'Automating bookkeeping for Irish SMEs';
  var REFRESH_MS  = 60 * 60 * 1000; // re-poll hourly (aligned with cron)

  function render(el, result) {
    var pct = result && result.available && typeof result.pctAutomated === 'number'
      ? result.pctAutomated
      : null;

    if (pct !== null) {
      el.textContent = pct + '% of bookkeeping automated';
      el.setAttribute('data-ledgrly-state', 'live');
    } else {
      el.textContent = FALLBACK;
      el.setAttribute('data-ledgrly-state', 'fallback');
    }
  }

  function start(el) {
    el.textContent = FALLBACK; // immediate; replaced on first fetch

    function refresh() {
      fetch(ENDPOINT)
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { if (data) render(el, data); })
        .catch(function () {}); // network fail — keep current text
    }

    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  document.querySelectorAll('[data-ledgrly-stats]').forEach(start);
})();
