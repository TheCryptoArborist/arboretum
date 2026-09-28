'use strict';
(() => {
  const tools = Array.from(document.querySelectorAll('details.tool'));
  const search = document.getElementById('tool-search');
  const category = document.getElementById('tool-category');
  const controls = document.getElementById('tool-controls');
  const count = document.getElementById('tool-count');
  const empty = document.getElementById('no-tools');
  if (!search || !category || !controls || !count || !empty) return;
  controls.hidden = false;
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const tool of tools) {
      const matches = (category.value === 'all' || tool.dataset.category === category.value) && tool.textContent.toLocaleLowerCase().includes(query);
      tool.hidden = !matches;
      if (matches) visible++;
    }
    count.textContent = `${visible} ${visible === 1 ? 'tool' : 'tools'} shown`;
    empty.hidden = visible !== 0;
  };
  search.addEventListener('input', filter);
  category.addEventListener('change', filter);
  document.getElementById('expand-tools').addEventListener('click', () => tools.filter(t => !t.hidden).forEach(t => { t.open = true; }));
  document.getElementById('collapse-tools').addEventListener('click', () => tools.filter(t => !t.hidden).forEach(t => { t.open = false; }));
  const reveal = () => {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target || !target.matches('details.tool')) return;
    search.value = ''; category.value = 'all'; filter(); target.open = true;
    requestAnimationFrame(() => target.scrollIntoView({block: 'start'}));
  };
  window.addEventListener('hashchange', reveal); reveal();
  document.querySelectorAll('.mobile-nav a').forEach(a => a.addEventListener('click', () => { a.closest('details').open = false; }));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const entry = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (entry) document.querySelectorAll('.side nav a').forEach(a => a.classList.toggle('active', a.hash === '#' + entry.target.id));
    }, {rootMargin: '-100px 0px -55% 0px'});
    document.querySelectorAll('main > section[id]').forEach(s => observer.observe(s));
  }
  const print = document.getElementById('print-guide');
  if (print) { print.hidden = false; print.addEventListener('click', () => window.print()); }
  let printState = null;
  window.addEventListener('beforeprint', () => {
    if (printState) return;
    printState = Array.from(document.querySelectorAll('main details')).map(el => ({el, open: el.open, hidden: el.hidden}));
    printState.forEach(({el}) => { el.hidden = false; el.open = true; });
  });
  window.addEventListener('afterprint', () => {
    if (!printState) return;
    printState.forEach(({el,open,hidden}) => { el.open = open; el.hidden = hidden; }); printState = null;
  });
})();
