(() => {
  try {
    const cookieTheme = document.cookie.match(/(?:^|;\s*)sbm_theme=(system|light|dark)(?:;|$)/)?.[1];
    const saved = localStorage.getItem('sbm.theme') || cookieTheme;
    const preference = ['system', 'light', 'dark'].includes(saved) ? saved : 'light';
    const resolved = preference === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    document.querySelector('#themeColor').content = resolved === 'dark' ? '#121519' : '#f5f6f8';
  } catch {}
})();
