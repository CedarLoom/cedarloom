import type {ReactNode} from 'react';
import {usePluginData} from '@docusaurus/useGlobalData';
import Heading from '@theme/Heading';
import type {Skill, StartedBy} from '../../skills-plugin';
import Icon, {type IconName} from './Icon';
import styles from './SkillList.module.css';

const repo = 'https://github.com/CedarLoom/cedarloom';

const start: Record<StartedBy, [IconName, string]> = {
  you: ['person', 'you'],
  agent: ['bot', 'the agent'],
  both: ['bot', 'the agent, or you'],
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
      <ul className={styles.grid}>
        {skills
          .filter((s) => s.plugin === plugin)
          .map((s) => {
            const [icon, label] = start[s.startedBy];
            return (
              <li key={s.name} className={styles.card}>
                <a className={styles.command} href={`${repo}/blob/main/plugins/${s.plugin}/skills/${s.name}/SKILL.md`}>
                  <code>
                    /{s.plugin}:{s.name}
                  </code>
                </a>
                <p className={styles.purpose}>{s.purpose}</p>
                <p className={styles.start}>
                  <Icon name={icon} /> Started by {label}
                </p>
              </li>
            );
          })}
      </ul>
    </section>
  ));
}
