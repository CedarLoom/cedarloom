import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import {relative, resolve} from 'node:path';
import {referencePages, repoLinks} from './repo-links';
import {repoFacts} from './scripts/repo-facts.mts';

const slug = 'CedarLoom/cedarloom';
const repo = `https://github.com/${slug}`;
const baseUrl = '/cedarloom/';
const root = resolve(__dirname, '..');

// An async config creator, so the build can read the repository facts first.
export default async (): Promise<Config> => ({
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
    // .md files are CommonMark (the repository docs), .mdx files are MDX (the guide pages with components).
    format: 'detect',
    hooks: {onBrokenMarkdownLinks: 'throw'},
    // The reference pages are repository files without front matter: their slug and label come from referencePages.
    parseFrontMatter: async (params) => {
      const result = await params.defaultParseFrontMatter(params);
      const page = referencePages[relative(root, params.filePath)];
      return page ? {...result, frontMatter: {...result.frontMatter, ...page}} : result;
    },
  },
  // static/ holds the cedarloom.json schema, written by .github/scripts/skills-doc.mjs. The logos stay in brand/ under their own terms; the site serves them from there.
  staticDirectories: ['static', '../brand'],
  i18n: {defaultLocale: 'en', locales: ['en']},
  presets: [
    [
      'classic',
      {
        // One docs instance over the repository: the guide in site/docs and the repository docs it links to.
        docs: {
          path: '..',
          include: ['site/docs/*.mdx', ...Object.keys(referencePages)],
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          beforeDefaultRemarkPlugins: [repoLinks({root, repo})],
        },
        blog: false,
        theme: {customCss: './src/css/custom.css'},
      } satisfies Preset.Options,
    ],
  ],
  plugins: ['./skills-plugin.ts'],
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
        {type: 'docSidebar', sidebarId: 'reference', label: 'Reference', position: 'left'},
        // read once per build, the browser makes no request to GitHub
        {type: 'custom-repo', repo: slug, facts: await repoFacts(slug), position: 'right'},
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
      copyright: 'Code and docs under the MIT license. The CedarLoom name and logos are not.',
    },
    prism: {theme: prismThemes.github, darkTheme: prismThemes.dracula},
  } satisfies Preset.ThemeConfig,
});
