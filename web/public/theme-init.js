// Applies the saved or system theme before first paint to avoid a flash. Kept as an external
// file (not an inline <script> in index.html) so the app's Content-Security-Policy can use
// `script-src 'self'` without `'unsafe-inline'`.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('sylvan-theme') || 'system';
  } catch (e) {}
  var dark =
    pref === 'dark' ||
    (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();
