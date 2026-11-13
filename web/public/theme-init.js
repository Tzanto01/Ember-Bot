(function () {
  var themes = ['hearthlight', 'fieldnotes', 'tidepool', 'marigold'];
  var root = document.documentElement;
  var theme = null;
  try {
    theme = localStorage.getItem('ember.theme');
  } catch (e) {}
  root.setAttribute('data-theme', themes.indexOf(theme) >= 0 ? theme : 'hearthlight');
  try {
    if (localStorage.getItem('ember.calm') === '1') root.setAttribute('data-calm', '');
  } catch (e) {}
  var query = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    var scheme = null;
    try {
      scheme = localStorage.getItem('ember.colorScheme');
    } catch (e) {}
    root.classList.toggle('dark', scheme === 'dark' || (scheme !== 'light' && query.matches));
  }
  apply();
  query.addEventListener('change', apply);
})();
