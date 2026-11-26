import {existsSync, statSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';

type Node = {type: string; url?: string; value?: string; children?: Node[]};
type File = {path: string};

// Pages the reference docs serve from repository files, by path from the repository root; the keys are the docs.
export const referencePages: Record<string, {slug: string; sidebar_label?: string}> = {
  'README.md': {slug: '/', sidebar_label: 'Get started'},
  'docs/plugins.md': {slug: '/plugins'},
  'docs/skills.md': {slug: '/skills'},
  'docs/stack.md': {slug: '/stack'},
  'docs/development.md': {slug: '/development'},
  'docs/authoring.md': {slug: '/authoring'},
  'docs/releasing.md': {slug: '/releasing'},
  'SECURITY.md': {slug: '/security'},
};

// Relative links in the repository docs: a link to another reference page stays for Docusaurus to resolve; a link to
// any other repository file or folder becomes its GitHub URL. A link to a missing path fails the build.
export function repoLinks({root, repo, baseUrl}: {root: string; repo: string; baseUrl: string}) {
  const rewrite = (url: string, file: File): string => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return url;
    const [path, hash = ''] = url.split('#');
    const target = resolve(dirname(file.path), path);
    const fromRoot = relative(root, target);
    if (fromRoot in referencePages) return url;
    if (!existsSync(target)) throw new Error(`${relative(root, file.path)}: link to a missing path ${url}`);
    const kind = statSync(target).isDirectory() ? 'tree' : 'blob';
    return `${repo}/${kind}/main/${fromRoot}${hash ? `#${hash}` : ''}`;
  };
  const walk = (node: Node, file: File) => {
    if ((node.type === 'link' || node.type === 'definition') && node.url) node.url = rewrite(node.url, file);
    // The README's logo is raw HTML pointing into brand/, which the site serves from its root.
    if (node.type === 'html' && node.value) node.value = node.value.replace(/(src|srcset)="brand\//g, `$1="${baseUrl}`);
    node.children?.forEach((child) => walk(child, file));
  };
  return () => (tree: Node, file: File) => walk(tree, file);
}
