// Writes brand/tokens.css (in the format Biome prints) from brand/tokens.json; with --check it writes nothing and fails when tokens.css differs.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('tokens.json', import.meta.url));
const target = fileURLToPath(new URL('tokens.css', import.meta.url));

// The unicode ranges of the Albert Sans subsets in brand/fonts/.
const subsets = [
  [
    'latin',
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  ],
  [
    'latin-ext',
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  ],
];

function lookup(tokens, path) {
  const token = path.split('.').reduce((group, key) => group?.[key], tokens);
  if (token?.$value === undefined) throw new Error(`tokens.json: no token at {${path}}`);
  return token;
}

function color(tokens, value) {
  if (typeof value === 'string') {
    const alias = /^\{(.+)\}$/.exec(value);
    if (!alias) throw new Error(`tokens.json: ${value} is neither a color object nor an alias`);
    return color(tokens, lookup(tokens, alias[1]).$value);
  }
  if (value.hex) return value.hex;
  if (value.colorSpace === 'oklch') return `oklch(${value.components.join(' ')})`;
  throw new Error(`tokens.json: color space ${value.colorSpace} needs a hex value`);
}

function declarations(tokens, scheme) {
  return Object.entries(tokens.color[scheme])
    .filter(([name]) => !name.startsWith('$'))
    .map(([name, token]) => `  --cl-${name}: ${color(tokens, token.$value)};`)
    .join('\n');
}

function fontFamily(family) {
  return family.map((name) => (/^[\w-]+$/.test(name) ? name : `"${name}"`)).join(', ');
}

function tokensCss(tokens) {
  const [family, ...fallbacks] = tokens.font.family.$value;
  const weights = Object.entries(tokens.font.weight)
    .filter(([name]) => !name.startsWith('$'))
    .map(([name, token]) => `  --cl-font-weight-${name}: ${token.$value};`);
  const faces = subsets.flatMap(([subset, range]) =>
    ['normal', 'italic'].map(
      (style) => `@font-face {
  font-family: "${family}";
  font-style: ${style};
  font-weight: 100 900;
  font-display: swap;
  src: url("fonts/albert-sans-${subset}-wght-${style}.woff2") format("woff2");
  unicode-range:
    ${range};
}`,
    ),
  );
  // Arial (Liberation Sans has its metrics) scaled to Albert Sans, so text keeps its size and lines when the web font swaps in.
  // From the regular faces: average width 463/1000 and 913/2048 em, ascent 950 and descent 250 per 1000 em (@capsizecss/metrics).
  const fallbackFace = `@font-face {
  font-family: "${family} Fallback";
  src: local("Arial"), local("Liberation Sans");
  size-adjust: 103.86%;
  ascent-override: 91.47%;
  descent-override: 24.07%;
  line-gap-override: 0%;
}`;
  const light = declarations(tokens, 'light');
  const dark = declarations(tokens, 'dark');
  return `/* Generated from brand/tokens.json by brand/build-tokens.mjs: edit the JSON, then run node brand/build-tokens.mjs. */
${[...faces, fallbackFace].join('\n\n')}

:root {
  --cl-font-family: ${fontFamily([family, `${family} Fallback`, ...fallbacks])};
${weights.join('\n')}
${light}
}

/* The system scheme applies unless the page sets data-theme; a page with a theme toggle sets it. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${dark.replaceAll('\n', '\n  ').replace(/^/, '  ')}
  }
}

[data-theme="dark"] {
${dark}
}
`;
}

const css = tokensCss(JSON.parse(readFileSync(source, 'utf8')));
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== css) {
    console.error(
      'brand/tokens.css differs from brand/tokens.json: run node brand/build-tokens.mjs and commit the result',
    );
    process.exit(1);
  }
} else {
  writeFileSync(target, css);
}
