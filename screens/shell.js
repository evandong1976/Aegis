/* The Aegis application shell: nav rail, top bar, page frame.
   Every screen calls Shell.mount(h(Shell.Shell, {page, eyebrow, title}, …content)). */
(function () {
  'use strict';
  var A = window.Aegis, h = React.createElement;

  var NAV = [
    { key: 'overview', label: 'Overview', icon: 'dashboard', href: 'overview.html' },
    { key: 'links', label: 'Links', icon: 'globe', href: 'links.html', count: '46' },
    { key: 'downloads', label: 'Downloads', icon: 'file-search', href: 'downloads.html', count: '37' },
    { key: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' }
  ];

  /* Verdicts map onto the system's five severity levels. One place, so every
     screen agrees: a malicious verdict is always critical, never "red". */
  var VERDICT = { malicious: 'critical', suspicious: 'high', unknown: 'medium', clean: 'secure' };
  function Verdict(props) {
    var word = props.verdict;
    return h(A.SeverityBadge, { level: VERDICT[word] || 'medium', subtle: props.subtle },
      word.charAt(0).toUpperCase() + word.slice(1));
  }

  function TopBar(props) {
    return h('header', { className: 'topbar' },
      h('div', { className: 'topbar__titles' },
        h('p', { className: 'ae-label topbar__eyebrow' }, props.eyebrow),
        h('h1', { className: 'topbar__title' }, props.title)
      ),
      h('div', { className: 'topbar__search' }, h(A.SearchField, { placeholder: 'Search URLs, files or hashes', shortcut: '⌘K' })),
      h('div', { className: 'topbar__actions' },
        h(A.Button, { variant: 'ghost', size: 'sm', icon: 'bell', 'aria-label': 'Notifications' }),
        h('div', { className: 'topbar__who' },
          h('span', { className: 'topbar__avatar' }, 'DO'),
          h('span', null, 'Northwind')
        )
      )
    );
  }

  function Shell(props) {
    return h('div', { className: 'app' },
      h('div', { className: 'app__rail' },
        h(A.NavRail, {
          brand: 'Aegis',
          items: NAV.map(function (n) {
            return { label: n.label, icon: n.icon, href: n.href, count: n.count, active: n.key === props.page };
          })
        })
      ),
      h('div', { className: 'app__main' },
        h(TopBar, { title: props.title, eyebrow: props.eyebrow }),
        props.children
      )
    );
  }

  /* a small stacked bar chart, tokens only */
  function Bars(props) {
    return h('div', null,
      h('div', { className: 'bars' }, props.columns.map(function (col, i) {
        return h('div', { className: 'bars__col', key: i },
          h('div', { className: 'bars__stack' }, col.segments.map(function (s, j) {
            return h('div', {
              key: j, className: 'bars__seg',
              style: { background: 'var(--' + s.token + ')', height: (s.value / props.max) * 100 + '%', minHeight: s.value ? '3px' : 0 },
              title: s.label + ': ' + s.value
            });
          })),
          h('p', { className: 'bars__label' }, col.label)
        );
      })),
      props.legend ? h('div', { className: 'legend', style: { marginTop: 'var(--space-4)' } },
        props.legend.map(function (l, i) {
          return h('span', { className: 'legend__item', key: i },
            h('span', { className: 'legend__swatch', style: { background: 'var(--' + l.token + ')' } }), l.label);
        })) : null
    );
  }

  function KV(props) {
    return h('div', { className: 'kv' }, props.items.map(function (it, i) {
      return h(React.Fragment, { key: i },
        h('span', { className: 'kv__k' }, it.k),
        h('span', { className: 'kv__v' }, it.v));
    }));
  }

  function mount(node) {
    ReactDOM.createRoot(document.getElementById('root')).render(node);
  }

  window.Shell = { Shell: Shell, TopBar: TopBar, Bars: Bars, KV: KV, Verdict: Verdict, VERDICT: VERDICT, mount: mount, NAV: NAV };
})();
