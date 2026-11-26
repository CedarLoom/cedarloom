import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {LoadContext, Plugin} from '@docusaurus/types';

export type StartedBy = 'you' | 'agent' | 'both';

export type Skill = {
  name: string;
  plugin: string;
  purpose: string;
  startedBy: StartedBy;
};

type Entry = {name: string; plugin: string; purpose: string};
type SkillsDoc = {sources: () => Entry[]};
type SkillLint = {frontMatter: (text: string) => Record<string, string | Record<string, string>>};

// Reads the skills with the parser that writes docs/skills.md, so the page and that table name the same skills.
export default function skillsPlugin(context: LoadContext): Plugin<Skill[]> {
  const root = resolve(context.siteDir, '..');
  const script = (name: string) => pathToFileURL(join(root, '.github/scripts', name)).href;
  return {
    name: 'cedarloom-skills',
    async loadContent() {
      const {sources} = (await import(script('skills-doc.mjs'))) as SkillsDoc;
      const {frontMatter} = (await import(script('skill-lint.mjs'))) as SkillLint;
      return sources().map(({name, plugin, purpose}) => {
        const fm = frontMatter(readFileSync(join(root, 'plugins', plugin, 'skills', name, 'SKILL.md'), 'utf8'));
        const startedBy: StartedBy =
          fm['disable-model-invocation'] === 'true' ? 'you' : fm['user-invocable'] === 'false' ? 'agent' : 'both';
        return {name, plugin, purpose, startedBy};
      });
    },
    contentLoaded({content, actions}) {
      actions.setGlobalData(content);
    },
    getPathsToWatch() {
      return [join(root, 'plugins/*/skills/*/SKILL.md')];
    },
  };
}
