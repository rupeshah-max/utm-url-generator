// Shared floating navigation bar. Injected on every page at DOMContentLoaded.
(function () {
  const LINKS = [
    { href: 'index.html', label: 'Home' },
    { href: 'scheduled-tasks.html', label: 'Scheduled Tasks' },
    { href: 'scheduled-results.html', label: 'Scheduled Results' },
  ];

  function currentFile() {
    const path = window.location.pathname.split('/').pop();
    return path === '' ? 'index.html' : path;
  }

  function renderNav() {
    const current = currentFile();
    const nav = document.createElement('nav');
    nav.className = 'floating-nav';
    nav.setAttribute('aria-label', 'Primary navigation');

    nav.innerHTML = LINKS.map((link) => `
      <a href="${link.href}" class="${link.href === current ? 'active' : ''}">
        <span class="nav-dot" aria-hidden="true"></span>${link.label}
      </a>
    `).join('');

    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderNav);
  } else {
    renderNav();
  }
})();