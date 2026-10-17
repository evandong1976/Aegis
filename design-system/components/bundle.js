/* @ds-bundle: {"format":4,"namespace":"Aegis","components":[{"name":"Button"},{"name":"SeverityBadge"},{"name":"Card"},{"name":"StatTile"},{"name":"ScoreRing"},{"name":"ThreatTable"},{"name":"AlertBanner"},{"name":"Field"},{"name":"SearchField"},{"name":"Toggle"},{"name":"NavRail"},{"name":"Tabs"},{"name":"Meter"},{"name":"LogStream"},{"name":"EmptyState"},{"name":"Icon"}] */
(function () {
  'use strict';
  var React = window.React, h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  /* ---- Icon -------------------------------------------------------- */
  /* Paths traced from lucide-static v1.58.0 (ISC), the system's icon set.
     Icons inherit color from the text around them via currentColor. */
  var PATHS = {
    shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'],
    'shield-check': ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
    'shield-alert': ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'M12 8v4', 'M12 16h.01'],
    lock: ['M19 11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
    key: ['M12.4 2.7a2.5 2.5 0 0 1 3.4 0l5.5 5.5a2.5 2.5 0 0 1 0 3.4l-3.7 3.7a2.5 2.5 0 0 1-3.4 0L8.7 9.8a2.5 2.5 0 0 1 0-3.4z', 'm14 7 3 3', 'M9.4 10.6 2 18v4h4l1-1v-2h2v-2h2l1.4-1.4'],
    alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    activity: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'],
    scan: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M3 12h18'],
    database: ['M3 5V19A9 3 0 0 0 21 19V5', 'M3 12A9 3 0 0 0 21 12', 'M12 2c-4.97 0-9 1.34-9 3s4.03 3 9 3 9-1.34 9-3-4.03-3-9-3'],
    globe: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M10 7a4 4 0 1 0 0 .01', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    bell: ['M10.3 21a1.94 1.94 0 0 0 3.4 0', 'M21 18H3a2 2 0 0 0 2-2V9a7 7 0 1 1 14 0v7a2 2 0 0 0 2 2'],
    search: ['M11 3a8 8 0 1 0 0 16 8 8 0 1 0 0-16', 'm21 21-4.3-4.3'],
    check: ['M20 6 9 17l-5-5'],
    x: ['M18 6 6 18', 'm6 6 12 12'],
    info: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'M12 16v-4', 'M12 8h.01'],
    'check-circle': ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'm9 12 2 2 4-4'],
    dashboard: ['M3 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M15 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2', 'M5 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2', 'M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2'],
    bug: ['M14 2a2 2 0 0 1 2 2v2H8V4a2 2 0 0 1 2-2z', 'M6 10a6 6 0 0 1 12 0v4a6 6 0 0 1-12 0z', 'M3 11h3', 'M18 11h3', 'M4 19l2.5-2', 'M20 19l-2.5-2', 'M4 5l2.5 2', 'M20 5l-2.5 2'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1'],
    radar: ['M19.07 4.93A10 10 0 0 0 6.99 3.34', 'M4 6h.01', 'M2.29 9.62A10 10 0 1 0 21.31 8.35', 'M16.24 7.76A6 6 0 1 0 8.23 16.67', 'M12 18h.01', 'M17.99 11.66A6 6 0 0 1 15.77 16.67', 'm22 2-9.6 9.6', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2'],
    'file-search': ['M14 2v4a2 2 0 0 0 2 2h4', 'M4 4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M11.5 13.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5', 'm16 18-1.7-1.7'],
    'wifi-off': ['m2 2 20 20', 'M8.5 16.5a5 5 0 0 1 7 0', 'M2 8.82a15 15 0 0 1 4.17-2.65', 'M10.66 5c4.01-.36 8.14.9 11.34 3.76', 'M16.85 11.25a10 10 0 0 1 2.22 1.68', 'M5 13a10 10 0 0 1 5.24-2.76', 'M12 20h.01'],
    arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
    'trend-up': ['M16 7h6v6', 'm22 7-8.5 8.5-5-5L2 17'],
    'trend-down': ['M16 17h6v-6', 'm22 17-8.5-8.5-5 5L2 7']
  };

  function Icon(props) {
    props = props || {};
    var name = props.name, size = props.size || 20, paths = PATHS[name] || PATHS.shield;
    return h('svg', {
      className: cx('ae-icon', props.className), width: size, height: size, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: props.strokeWidth || 1.75,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false'
    }, paths.map(function (d, i) { return h('path', { key: i, d: d }); }));
  }

  /* ---- Button ------------------------------------------------------ */
  function Button(props) {
    props = props || {};
    var variant = props.variant || 'primary', size = props.size || 'md';
    var rest = {};
    for (var k in props) if (['variant', 'size', 'icon', 'iconEnd', 'className', 'children', 'full'].indexOf(k) < 0) rest[k] = props[k];
    return h('button', Object.assign({
      type: props.type || 'button',
      className: cx('ae-btn', 'ae-btn--' + variant, 'ae-btn--' + size, props.full && 'ae-btn--full', props.className)
    }, rest),
      props.icon ? h(Icon, { name: props.icon, size: size === 'sm' ? 15 : 17 }) : null,
      props.children != null ? h('span', null, props.children) : null,
      props.iconEnd ? h(Icon, { name: props.iconEnd, size: size === 'sm' ? 15 : 17 }) : null
    );
  }

  /* ---- SeverityBadge ----------------------------------------------- */
  var SEV = {
    critical: { label: 'Critical', icon: 'shield-alert' },
    high: { label: 'High', icon: 'alert' },
    medium: { label: 'Medium', icon: 'info' },
    low: { label: 'Low', icon: 'activity' },
    secure: { label: 'Secure', icon: 'check-circle' }
  };
  function SeverityBadge(props) {
    props = props || {};
    var level = SEV[props.level] ? props.level : 'medium', meta = SEV[level];
    return h('span', { className: cx('ae-badge', 'ae-badge--' + level, props.subtle && 'ae-badge--subtle', props.className) },
      h(Icon, { name: meta.icon, size: 13, strokeWidth: 2 }),
      h('span', null, props.children != null ? props.children : meta.label)
    );
  }

  /* ---- Card -------------------------------------------------------- */
  function Card(props) {
    props = props || {};
    return h('section', { className: cx('ae-card', props.highlight && 'ae-card--glow', props.className) },
      (props.title || props.action) ? h('header', { className: 'ae-card__head' },
        h('div', null,
          props.eyebrow ? h('p', { className: 'ae-label ae-card__eyebrow' }, props.eyebrow) : null,
          props.title ? h('h3', { className: 'ae-card__title' }, props.title) : null,
          props.description ? h('p', { className: 'ae-card__desc' }, props.description) : null
        ),
        props.action ? h('div', { className: 'ae-card__action' }, props.action) : null
      ) : null,
      h('div', { className: 'ae-card__body' }, props.children)
    );
  }

  /* ---- StatTile ---------------------------------------------------- */
  function Sparkline(props) {
    var pts = props.points || [], w = 104, hgt = 32;
    if (pts.length < 2) return null;
    var max = Math.max.apply(null, pts), min = Math.min.apply(null, pts), span = (max - min) || 1;
    var d = pts.map(function (v, i) {
      var x = (i / (pts.length - 1)) * w, y = hgt - ((v - min) / span) * (hgt - 4) - 2;
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    return h('svg', { className: 'ae-spark', width: w, height: hgt, viewBox: '0 0 ' + w + ' ' + hgt, 'aria-hidden': 'true' },
      h('path', { d: d + ' L' + w + ' ' + hgt + ' L0 ' + hgt + ' Z', className: 'ae-spark__fill' }),
      h('path', { d: d, className: 'ae-spark__line' })
    );
  }
  function StatTile(props) {
    props = props || {};
    var dir = props.direction, good = props.intent === 'good' ? 'up' : props.intent === 'bad' ? 'down' : null;
    var tone = dir ? (dir === good ? 'pos' : 'neg') : 'flat';
    return h('article', { className: cx('ae-stat', props.className) },
      h('div', { className: 'ae-stat__top' },
        h('p', { className: 'ae-label' }, props.label),
        props.icon ? h('span', { className: 'ae-stat__icon' }, h(Icon, { name: props.icon, size: 16 })) : null
      ),
      h('p', { className: 'ae-stat__value' }, props.value, props.unit ? h('span', { className: 'ae-stat__unit' }, props.unit) : null),
      h('div', { className: 'ae-stat__foot' },
        props.delta ? h('span', { className: 'ae-delta ae-delta--' + tone },
          h(Icon, { name: dir === 'down' ? 'trend-down' : 'trend-up', size: 13, strokeWidth: 2 }),
          h('span', null, props.delta)) : null,
        props.caption ? h('span', { className: 'ae-stat__caption' }, props.caption) : null,
        props.points ? h(Sparkline, { points: props.points }) : null
      )
    );
  }

  /* ---- ScoreRing --------------------------------------------------- */
  function ScoreRing(props) {
    props = props || {};
    var size = props.size || 168, value = Math.max(0, Math.min(100, props.value == null ? 0 : props.value));
    var sw = props.strokeWidth || 12, r = (size - sw) / 2, c = 2 * Math.PI * r;
    return h('div', { className: cx('ae-ring', props.className), style: { width: size } },
      h('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, role: 'img', 'aria-label': (props.label || 'Score') + ': ' + value + ' of 100' },
        h('circle', { className: 'ae-ring__track', cx: size / 2, cy: size / 2, r: r, strokeWidth: sw }),
        h('circle', {
          className: 'ae-ring__bar', cx: size / 2, cy: size / 2, r: r, strokeWidth: sw,
          strokeDasharray: c, strokeDashoffset: c * (1 - value / 100),
          transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'
        })
      ),
      h('div', { className: 'ae-ring__center' },
        h('p', { className: 'ae-ring__value' }, value),
        props.label ? h('p', { className: 'ae-ring__label' }, props.label) : null
      )
    );
  }

  /* ---- ThreatTable ------------------------------------------------- */
  function ThreatTable(props) {
    props = props || {};
    var cols = props.columns || [], rows = props.rows || [];
    return h('div', { className: cx('ae-table-wrap', props.className) },
      h('table', { className: 'ae-table' },
        h('thead', null, h('tr', null, cols.map(function (col, i) {
          return h('th', { key: i, className: cx(col.align === 'right' && 'is-right'), scope: 'col' }, h('span', { className: 'ae-label' }, col.header));
        }))),
        h('tbody', null, rows.map(function (row, ri) {
          return h('tr', { key: ri }, cols.map(function (col, ci) {
            return h('td', { key: ci, className: cx(col.mono && 'ae-mono', col.nowrap && 'is-nowrap', col.align === 'right' && 'is-right') }, row[col.key]);
          }));
        }))
      )
    );
  }

  /* ---- AlertBanner -------------------------------------------------- */
  var ALERT_ICON = { critical: 'shield-alert', warning: 'alert', info: 'info', success: 'check-circle' };
  function AlertBanner(props) {
    props = props || {};
    var tone = ALERT_ICON[props.tone] ? props.tone : 'info';
    return h('div', { className: cx('ae-alert', 'ae-alert--' + tone, props.className), role: tone === 'critical' ? 'alert' : 'status' },
      h('span', { className: 'ae-alert__icon' }, h(Icon, { name: ALERT_ICON[tone], size: 18 })),
      h('div', { className: 'ae-alert__body' },
        h('p', { className: 'ae-alert__title' }, props.title),
        props.children != null ? h('p', { className: 'ae-alert__text' }, props.children) : null
      ),
      props.action ? h('div', { className: 'ae-alert__action' }, props.action) : null
    );
  }

  /* ---- Field / SearchField ------------------------------------------ */
  function Field(props) {
    props = props || {};
    var id = props.id || ('ae-f-' + (props.name || props.label || '').replace(/\W+/g, '-').toLowerCase());
    var rest = {};
    for (var k in props) if (['label', 'hint', 'error', 'icon', 'className', 'id'].indexOf(k) < 0) rest[k] = props[k];
    return h('div', { className: cx('ae-field', props.error && 'is-error', props.className) },
      h('label', { className: 'ae-field__label', htmlFor: id }, props.label),
      h('div', { className: 'ae-field__control' },
        props.icon ? h('span', { className: 'ae-field__icon' }, h(Icon, { name: props.icon, size: 16 })) : null,
        h('input', Object.assign({ id: id, className: 'ae-input', 'aria-invalid': props.error ? 'true' : undefined, 'aria-describedby': (props.hint || props.error) ? id + '-d' : undefined }, rest))
      ),
      (props.error || props.hint) ? h('p', { id: id + '-d', className: cx('ae-field__hint', props.error && 'is-error') },
        props.error ? h(Icon, { name: 'alert', size: 13, strokeWidth: 2 }) : null,
        h('span', null, props.error || props.hint)) : null
    );
  }
  function SearchField(props) {
    props = props || {};
    var rest = {};
    for (var k in props) if (['className', 'shortcut'].indexOf(k) < 0) rest[k] = props[k];
    return h('div', { className: cx('ae-search', props.className) },
      h('span', { className: 'ae-search__icon' }, h(Icon, { name: 'search', size: 16 })),
      h('input', Object.assign({ type: 'search', className: 'ae-input ae-input--search', placeholder: props.placeholder || 'Search assets, IPs, CVEs', 'aria-label': props['aria-label'] || 'Search' }, rest)),
      props.shortcut ? h('kbd', { className: 'ae-kbd' }, props.shortcut) : null
    );
  }

  /* ---- Toggle -------------------------------------------------------- */
  function Toggle(props) {
    props = props || {};
    return h('button', {
      type: 'button', role: 'switch', 'aria-checked': props.checked ? 'true' : 'false',
      className: cx('ae-toggle', props.checked && 'is-on', props.className), onClick: props.onChange, disabled: props.disabled
    },
      h('span', { className: 'ae-toggle__track' }, h('span', { className: 'ae-toggle__thumb' })),
      props.label ? h('span', { className: 'ae-toggle__label' }, props.label) : null
    );
  }

  /* ---- NavRail ------------------------------------------------------- */
  function NavRail(props) {
    props = props || {};
    var items = props.items || [];
    return h('nav', { className: cx('ae-rail', props.className), 'aria-label': props['aria-label'] || 'Primary' },
      props.brand ? h('div', { className: 'ae-rail__brand' }, h(Icon, { name: 'shield-check', size: 20 }), h('span', null, props.brand)) : null,
      h('ul', { className: 'ae-rail__list' }, items.map(function (item, i) {
        return h('li', { key: i },
          h('a', { href: item.href || '#', className: cx('ae-rail__item', item.active && 'is-active'), 'aria-current': item.active ? 'page' : undefined },
            h(Icon, { name: item.icon, size: 18 }),
            h('span', { className: 'ae-rail__text' }, item.label),
            item.count ? h('span', { className: 'ae-rail__count' }, item.count) : null
          ));
      }))
    );
  }

  /* ---- Tabs ----------------------------------------------------------- */
  function Tabs(props) {
    props = props || {};
    var items = props.items || [], value = props.value || (items[0] && items[0].value);
    return h('div', { className: cx('ae-tabs', props.className), role: 'tablist' }, items.map(function (t, i) {
      return h('button', {
        key: i, type: 'button', role: 'tab', 'aria-selected': t.value === value ? 'true' : 'false',
        className: cx('ae-tab', t.value === value && 'is-active'),
        onClick: props.onChange ? function () { props.onChange(t.value); } : undefined
      }, t.label, t.count != null ? h('span', { className: 'ae-tab__count' }, t.count) : null);
    }));
  }

  /* ---- Meter ----------------------------------------------------------- */
  function Meter(props) {
    props = props || {};
    var value = Math.max(0, Math.min(100, props.value || 0));
    return h('div', { className: cx('ae-meter', props.className) },
      h('div', { className: 'ae-meter__top' },
        h('span', { className: 'ae-meter__label' }, props.label),
        h('span', { className: 'ae-meter__value' }, props.display || value + '%')
      ),
      h('div', { className: 'ae-meter__track', role: 'img', 'aria-label': props.label + ': ' + value + ' percent' },
        h('div', { className: cx('ae-meter__bar', props.tone && 'ae-meter__bar--' + props.tone), style: { width: value + '%' } })
      )
    );
  }

  /* ---- LogStream -------------------------------------------------------- */
  function LogStream(props) {
    props = props || {};
    return h('div', { className: cx('ae-log', props.className) }, (props.lines || []).map(function (line, i) {
      return h('p', { key: i, className: cx('ae-log__line', line.level && 'ae-log__line--' + line.level) },
        h('span', { className: 'ae-log__time' }, line.time),
        line.level ? h('span', { className: 'ae-log__level' }, line.level) : null,
        h('span', { className: 'ae-log__text' }, line.text)
      );
    }));
  }

  /* ---- EmptyState --------------------------------------------------------- */
  function EmptyState(props) {
    props = props || {};
    return h('div', { className: cx('ae-empty', props.className) },
      h('span', { className: 'ae-empty__icon' }, h(Icon, { name: props.icon || 'radar', size: 26 })),
      h('h3', { className: 'ae-empty__title' }, props.title),
      props.description ? h('p', { className: 'ae-empty__text' }, props.description) : null,
      props.action ? h('div', { className: 'ae-empty__action' }, props.action) : null
    );
  }

  window.Aegis = {
    Icon: Icon, iconNames: Object.keys(PATHS), Button: Button, SeverityBadge: SeverityBadge, Card: Card,
    StatTile: StatTile, Sparkline: Sparkline, ScoreRing: ScoreRing, ThreatTable: ThreatTable,
    AlertBanner: AlertBanner, Field: Field, SearchField: SearchField, Toggle: Toggle,
    NavRail: NavRail, Tabs: Tabs, Meter: Meter, LogStream: LogStream, EmptyState: EmptyState
  };
})();
