#!/usr/bin/env node
/*
 * Compiles tokens.json → tokens.css.
 *
 *   node design-system/build-tokens.mjs          # write tokens.css
 *   node design-system/build-tokens.mjs --check  # fail if tokens.css is stale
 *
 * tokens.json is the source of truth. Never hand-edit tokens.css: this script
 * reproduces exactly what the published design system generates, so the repo
 * and the artifact stay in step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));

const themes = tokens.color.themes.map((t) => t.id);
const first = themes[0];
const valueFor = (token, theme) =>
  typeof token.value === 'string' ? token.value : (token.value[theme] ?? token.value[first]);

let css = `/* ${tokens.name} — generated from tokens.json */\n`;

for (const theme of themes) {
  const selector = theme === first ? `:root, [data-theme="${first}"]` : `[data-theme="${theme}"]`;
  const lines = [];
  for (const token of tokens.color.tokens) lines.push(`  --${token.name}: ${valueFor(token, theme)};`);
  for (const token of tokens.shadow?.tokens ?? []) lines.push(`  --${token.name}: ${valueFor(token, theme)};`);
  css += `${selector} {\n${lines.join('\n')}\n}\n`;
}

const plain = [];
for (const family of ['spacing', 'radius', 'blur']) {
  for (const token of tokens[family]?.tokens ?? []) plain.push(`  --${token.name}: ${token.value};`);
}
for (const [key, stack] of Object.entries(tokens.type.families)) plain.push(`  --font-${key}: ${stack};`);
css += `:root {\n${plain.join('\n')}\n}\n`;

for (const font of tokens.type.fonts) {
  css += `@font-face { font-family: "${font.family}"; src: url("${font.file}") format("woff2");` +
    ` font-weight: ${font.weight}; font-style: ${font.style ?? 'normal'}; font-display: swap; }\n`;
}

for (const group of tokens.type.groups) {
  for (const style of group.styles) {
    const family = style.family ?? group.family;
    css += `.${style.name} { font-family: var(--font-${family}); font-size: ${style.fontSize};` +
      ` line-height: ${style.lineHeight}; font-weight: ${style.fontWeight};` +
      (style.letterSpacing ? ` letter-spacing: ${style.letterSpacing};` : '') +
      (style.name === 'label' ? ' text-transform: uppercase;' : '') + ` }\n`;
  }
}

const out = join(here, 'tokens.css');
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch {}
  if (current !== css) {
    console.error('tokens.css is out of date — run: node design-system/build-tokens.mjs');
    process.exit(1);
  }
  console.log('tokens.css is up to date');
} else {
  writeFileSync(out, css);
  console.log(`wrote tokens.css — ${tokens.color.tokens.length} colors × ${themes.length} themes, ` +
    `${tokens.type.groups.reduce((n, g) => n + g.styles.length, 0)} text styles`);
}
