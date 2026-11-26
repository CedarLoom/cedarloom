import {existsSync, statSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';

type Node = {type: string; url?: string; value?: string; children?: Node[]};
type File = {path: string};

// Repository docs served as reference pages, by path from the repository root.
export const referencePages: Record<string, {slug: string; title?: string; sidebar_label?: string}> = {
  'README.md': {slug: '/reference', title: 'Get started', sidebar_label: 'Get started'},
  'docs/plugins.md': {slug: '/reference/plugins'},
  'docs/skills.md': {slug: '/reference/skills'},
  'docs/stack.md': {slug: '/reference/stack'},
  'docs/development.md': {slug: '/reference/development'},
  'docs/authoring.md': {slug: '/reference/authoring'},
  'docs/releasing.md': {slug: '/reference/releasing'},
  'SECURITY.md': {slug: '/reference/security'},
};

// Relative links in the repository docs: a link to another reference page stays for Docusaurus to resolve; a link to
// any other repository file or folder becomes its GitHub URL. A link to a missing path fails the build.
export function repoLinks({root, repo}: {root: string; repo: string}) {
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
    // The README's logo picks its file by the system color scheme, not the site's theme toggle, so the site leaves it out.
    if (!node.children) return;
    node.children = node.children.filter((child) => !(child.type === 'html' && child.value?.includes('<picture')));
    node.children.forEach((child) => walk(child, file));
  };
  return () => (tree: Node, file: File) => walk(tree, file);
}
