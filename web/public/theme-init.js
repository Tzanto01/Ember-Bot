(function () {
  var themes = ['hearthlight', 'fieldnotes', 'tidepool', 'marigold'];
  var root = document.documentElement;
  var theme = null;
  try {
    theme = localStorage.getItem('ember.theme');
  } catch (e) {}
  root.setAttribute('data-theme', themes.indexOf(theme) >= 0 ? theme : 'hearthlight');
  var query = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    root.classList.toggle('dark', query.matches);
  }
  apply();
  query.addEventListener('change', apply);
})();
