import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import {relative, resolve} from 'node:path';
import {referencePages, repoLinks} from './repo-links';

const repo = 'https://github.com/CedarLoom/cedarloom';
const baseUrl = '/cedarloom/';
const root = resolve(__dirname, '..');

const config: Config = {
  title: 'CedarLoom',
  tagline: 'A workflow for Claude Code, sized to the risk of each task.',
  favicon: 'cedarloom-icon.svg',
  future: {v4: true},
  url: 'https://cedarloom.github.io',
  baseUrl,
  organizationName: 'CedarLoom',
  projectName: 'cedarloom',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    hooks: {onBrokenMarkdownLinks: 'throw'},
    // The reference pages are repository files in plain Markdown: their slug and label come from referencePages.
    parseFrontMatter: async (params) => {
      const result = await params.defaultParseFrontMatter(params);
      const page = referencePages[relative(root, params.filePath)];
      return page ? {...result, frontMatter: {...result.frontMatter, ...page, format: 'md'}} : result;
    },
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
  plugins: [
    './skills-plugin.ts',
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'reference',
        path: '..',
        include: Object.keys(referencePages),
        routeBasePath: 'reference',
        sidebarPath: './sidebars-reference.ts',
        beforeDefaultRemarkPlugins: [repoLinks({root, repo, baseUrl})],
      },
    ],
  ],
  themeConfig: {
    image: 'cedarloom-light-1280x640.png',
    colorMode: {respectPrefersColorScheme: true},
    navbar: {
      title: 'CedarLoom',
      logo: {alt: '', src: 'cedarloom-icon.svg'},
      items: [
        {to: '/concepts', label: 'Concepts', position: 'left'},
        {to: '/principles', label: 'Principles', position: 'left'},
        {to: '/skills', label: 'Skills', position: 'left'},
        {to: '/lifecycle', label: 'Lifecycle', position: 'left'},
        {type: 'docSidebar', docsPluginId: 'reference', sidebarId: 'reference', label: 'Reference', position: 'left'},
        {href: repo, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      links: [
        {
          title: 'Reference',
          items: [
            {label: 'Get started', to: '/reference'},
            {label: 'The plugins', to: '/reference/plugins'},
            {label: 'Skills', to: '/reference/skills'},
            {label: 'Stack', to: '/reference/stack'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: repo},
            {label: 'Security', to: '/reference/security'},
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
