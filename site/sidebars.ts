import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// Doc IDs are paths from the repository root: the guide lives in site/docs, the reference in the repository docs.
const sidebars: SidebarsConfig = {
  guide: ['site/docs/concepts', 'site/docs/principles', 'site/docs/skills', 'site/docs/lifecycle'],
  reference: [
    'README',
    'docs/plugins',
    'docs/skills',
    'docs/stack',
    'docs/development',
    'docs/authoring',
    'docs/releasing',
    'SECURITY',
  ],
};

export default sidebars;
