import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const repo = 'https://github.com/CedarLoom/cedarloom';

const config: Config = {
  title: 'CedarLoom',
  tagline: 'A workflow for Claude Code, sized to the risk of each task.',
  favicon: 'cedarloom-icon.svg',
  future: {v4: true},
  url: 'https://cedarloom.github.io',
  baseUrl: '/cedarloom/',
  organizationName: 'CedarLoom',
  projectName: 'cedarloom',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    mermaid: true,
    hooks: {onBrokenMarkdownLinks: 'throw'},
  },
  // static/ holds the cedarloom.json schema, written by .github/scripts/skills-doc.mjs. The logos stay in brand/ under their own terms; the site serves them from there.
  staticDirectories: ['static', '../brand'],
  i18n: {defaultLocale: 'en', locales: ['en']},
  presets: [
    [
      'classic',
      {
        docs: {routeBasePath: '/', sidebarPath: './sidebars.ts'},
        blog: false,
        theme: {customCss: './src/css/custom.css'},
      } satisfies Preset.Options,
    ],
  ],
  themes: ['@docusaurus/theme-mermaid'],
  plugins: ['./skills-plugin.ts'],
  themeConfig: {
    image: 'cedarloom-light-1280x640.png',
    colorMode: {respectPrefersColorScheme: true},
    mermaid: {theme: {light: 'neutral', dark: 'dark'}},
    navbar: {
      title: 'CedarLoom',
      logo: {alt: '', src: 'cedarloom-icon.svg'},
      items: [
        {to: '/concepts', label: 'Concepts', position: 'left'},
        {to: '/principles', label: 'Principles', position: 'left'},
        {to: '/skills', label: 'Skills', position: 'left'},
        {to: '/lifecycle', label: 'Lifecycle', position: 'left'},
        {href: repo, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      links: [
        {
          title: 'Reference',
          items: [
            {label: 'The plugins', href: `${repo}/blob/main/docs/plugins.md`},
            {label: 'Skills', href: `${repo}/blob/main/docs/skills.md`},
            {label: 'Stack', href: `${repo}/blob/main/docs/stack.md`},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'README', href: `${repo}#readme`},
            {label: 'Security', href: `${repo}/blob/main/SECURITY.md`},
            {label: 'License', href: `${repo}/blob/main/LICENSE`},
          ],
        },
      ],
      copyright: 'Code and docs under the ISC license. The CedarLoom name and logos are not.',
    },
    prism: {theme: prismThemes.github, darkTheme: prismThemes.dracula},
  } satisfies Preset.ThemeConfig,
};

export default config;
