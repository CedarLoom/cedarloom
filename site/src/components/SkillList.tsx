import type {ReactNode} from 'react';
import {usePluginData} from '@docusaurus/useGlobalData';
import Heading from '@theme/Heading';
import type {Skill, StartedBy} from '../../skills-plugin';

const repo = 'https://github.com/CedarLoom/cedarloom';

const startLabel: Record<StartedBy, string> = {
  you: 'you type it',
  agent: 'the agent',
  both: 'the agent, or you',
};

// One list per plugin, in the order the plugins install.
const pluginOrder = ['cl-workflow', 'cl-repo', 'cl-orchestration'];

export default function SkillList(): ReactNode {
  const skills = usePluginData('cedarloom-skills') as Skill[];
  const plugins = [...new Set(skills.map((s) => s.plugin))].sort(
    (a, b) => pluginOrder.indexOf(a) - pluginOrder.indexOf(b),
  );
  return plugins.map((plugin) => (
    <section key={plugin}>
      <Heading as="h2" id={plugin}>
        {plugin}
      </Heading>
      <table>
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">What it is for</th>
            <th scope="col">Started by</th>
          </tr>
        </thead>
        <tbody>
          {skills
            .filter((s) => s.plugin === plugin)
            .map((s) => (
              <tr key={s.name}>
                <td>
                  <a href={`${repo}/blob/main/plugins/${s.plugin}/skills/${s.name}/SKILL.md`}>
                    <code>
                      /{s.plugin}:{s.name}
                    </code>
                  </a>
                </td>
                <td>{s.purpose}</td>
                <td>{startLabel[s.startedBy]}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  ));
}
