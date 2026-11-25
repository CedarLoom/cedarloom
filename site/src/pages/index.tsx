import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import CodeBlock from '@theme/CodeBlock';
import Heading from '@theme/Heading';
import Layout from '@theme/Layout';
import ThemedImage from '@theme/ThemedImage';
import styles from './index.module.css';

const repo = 'https://github.com/CedarLoom/cedarloom';

type PluginCard = {name: string; text: string; commands: string[]};

const plugins: PluginCard[] = [
  {
    name: 'cl-workflow',
    text: 'Sizes each task. Before the first edit the agent picks the kind (software change, docs pass, research) and the depth (quick, standard, deep), then runs the planning, test, review and verify steps that depth needs.',
    commands: ['/cl-workflow:dev', '/cl-workflow:plan', '/cl-workflow:away'],
  },
  {
    name: 'cl-repo',
    text: "Sets up and maintains a repository for agents: agent instructions, the dev container, the coordinator's policy, maintenance passes and audits. Each change is a plan item you approve first.",
    commands: ['/cl-repo:setup', '/cl-repo:maintain', '/cl-repo:audit'],
  },
  {
    name: 'cl-orchestration',
    text: "Works labeled issues of several projects in parallel from one coordinator session: a worker per issue, a fresh reviewer per pull request, and a merge only where the repository's written policy allows.",
    commands: ['/cl-orchestration:coordinate'],
  },
];

const install = `/plugin marketplace add CedarLoom/cedarloom#stable
/plugin install cedarloom@cedarloom`;

export default function Home(): ReactNode {
  return (
    <Layout description="CedarLoom gives Claude Code a workflow sized to the risk of each task, sets up repositories for agents and runs issue work from one coordinator.">
      <header className={styles.hero}>
        <div className="container">
          <Heading as="h1" className={styles.title}>
            <ThemedImage
              className={styles.wordmark}
              alt="CedarLoom"
              sources={{light: useBaseUrl('/cedarloom-light.svg'), dark: useBaseUrl('/cedarloom-dark.svg')}}
            />
          </Heading>
          <p className={styles.lead}>
            CedarLoom gives Claude Code a workflow: it sizes the planning, checks and review of each task to its risk,
            sets up and maintains your repositories for agents, and runs issue work across several projects from one
            coordinator session.
          </p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="#install">
              Install
            </Link>
            <Link className="button button--secondary button--lg" to="/concepts">
              How it works
            </Link>
          </div>
        </div>
      </header>
      <main className="container">
        <section className={styles.section}>
          <Heading as="h2">Three plugins</Heading>
          <p>
            They install from a marketplace, together as the <code>cedarloom</code> bundle or one by one. There is no
            app or package to run.
          </p>
          <div className={styles.cards}>
            {plugins.map((p) => (
              <article key={p.name} className={styles.card}>
                <Heading as="h3">
                  <code>{p.name}</code>
                </Heading>
                <p>{p.text}</p>
                <ul className={styles.commands}>
                  {p.commands.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
        <section className={styles.section}>
          <Heading as="h2" id="install">
            Install
          </Heading>
          <p>In a Claude Code session, add the marketplace on its stable branch and install the bundle:</p>
          <CodeBlock language="text">{install}</CodeBlock>
          <p>
            Then run <code>/reload-plugins</code> and type <code>/cl-workflow:</code> to see the commands. You need
            Claude Code 2.1.330 or later, Node.js on the PATH, Git and the GitHub CLI; the coordinator also needs Orca.
            The <Link href={`${repo}#install`}>README</Link> covers Codex, single plugins and updates.
          </p>
        </section>
        <section className={styles.section}>
          <Heading as="h2">Then</Heading>
          <ol className={styles.steps}>
            <li>
              Once per repository, run <code>/cl-repo:setup</code>.
            </li>
            <li>Per task, describe it. The workflow picks the depth and the checks.</li>
            <li>
              Per issue, add the start label (<code>cl:ready-for-agent</code> by default) and start the coordinator. It runs the{' '}
              <Link to="/lifecycle">lifecycle</Link> up to the merge; releases stay yours.
            </li>
          </ol>
        </section>
      </main>
    </Layout>
  );
}
