// Auto-retry for 5xx pages (<body data-retry="1">); hides "go back" when there is no history.
(function () {
  var back = document.getElementById('err-back');
  if (back) {
    back.addEventListener('click', function (e) { e.preventDefault(); history.back(); });
    if (history.length < 2) back.hidden = true;
  }
  if (!document.body.hasAttribute('data-retry')) return;
  var box = document.getElementById('err-retry'), out = document.getElementById('err-count');
  if (!box || !out) return;
  var left = 15;
  box.hidden = false;
  var t = setInterval(function () {
    left--; out.textContent = String(left);
    if (left <= 0) { clearInterval(t); location.reload(); }
  }, 1000);
})();
