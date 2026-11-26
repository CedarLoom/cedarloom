import type {CSSProperties, ReactNode} from 'react';
import clsx from 'clsx';
import Icon, {type IconName} from './Icon';
import styles from './Diagrams.module.css';

// Every diagram is lists and text in the page: each step, branch and message reads in order without the visuals.

type Outcome = {when: string; to: string; tone: 'go' | 'next' | 'back' | 'owner'};
type Step = {icon: IconName; title: string; text?: string; you?: boolean; outcomes?: Outcome[]};

const toneIcon: Record<Outcome['tone'], IconName> = {go: 'check', next: 'arrow', back: 'loop', owner: 'person'};

function Flow({steps, caption}: {steps: Step[]; caption: string}): ReactNode {
  return (
    <figure className={styles.figure}>
      <ol className={styles.flow}>
        {steps.map((s, i) => (
          <li key={s.title} className={clsx(styles.step, s.you && styles.you)}>
            <span className={styles.disc}>
              <Icon name={s.icon} />
              <span className={styles.num}>{i + 1}</span>
            </span>
            <div className={styles.card}>
              <p className={styles.title}>
                {s.title}
                {s.you && (
                  <span className={styles.youTag}>
                    <Icon name="person" /> you
                  </span>
                )}
              </p>
              {s.text && <p className={styles.text}>{s.text}</p>}
              {s.outcomes && (
                <ul className={styles.outcomes}>
                  {s.outcomes.map((o) => (
                    <li key={o.when} className={styles[o.tone]}>
                      <Icon name={toneIcon[o.tone]} />
                      <span>
                        {o.when}
                        <span className={styles.srOnly}>, then </span>
                        <span aria-hidden="true"> → </span>
                        <strong>{o.to}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function Lifecycle(): ReactNode {
  return (
    <Flow
      caption="An issue from card to release. Steps marked “you” are yours."
      steps={[
        {icon: 'tag', title: 'Card', text: 'You label the issue.', you: true},
        {icon: 'plan', title: 'Refine', text: 'Plan, questions, design approval.'},
        {icon: 'code', title: 'Build', text: 'A worker per issue.'},
        {
          icon: 'eye',
          title: 'Review',
          text: 'A fresh reviewer.',
          outcomes: [
            {when: 'findings', to: 'Fix: the worker, then a re-review', tone: 'back'},
            {when: 'clean', to: 'Merge', tone: 'go'},
          ],
        },
        {icon: 'merge', title: 'Merge', text: 'The coordinator, by the policy.'},
        {icon: 'flag', title: 'Release', text: 'Releases and tags stay yours.', you: true},
      ]}
    />
  );
}

export function ReviewLoop(): ReactNode {
  return (
    <Flow
      caption="Every pull request gets a fresh review; fixes get a scoped re-review, for up to 3 rounds."
      steps={[
        {icon: 'pr', title: 'Pull request'},
        {
          icon: 'eye',
          title: 'Fresh review',
          outcomes: [
            {when: 'clean', to: 'Ready to merge', tone: 'go'},
            {when: 'Blocking or Important', to: 'Worker fixes', tone: 'next'},
          ],
        },
        {icon: 'code', title: 'Worker fixes'},
        {
          icon: 'eye',
          title: 'Scoped re-review',
          outcomes: [
            {when: 'clean', to: 'Ready to merge', tone: 'go'},
            {when: 'findings, rounds 1 and 2', to: 'Worker fixes', tone: 'back'},
            {when: 'findings after round 3', to: 'Owner decides', tone: 'owner'},
          ],
        },
      ]}
    />
  );
}

export function TrustCheck(): ReactNode {
  return (
    <Flow
      caption="Only text by trusted authors reaches workers and reviewers."
      steps={[
        {icon: 'text', title: 'Issue or pull request text'},
        {
          icon: 'shield',
          title: 'Trusted author?',
          outcomes: [
            {when: 'yes', to: 'Worker and reviewer read it', tone: 'go'},
            {when: 'no, or lookup failed', to: 'Left out and counted', tone: 'owner'},
          ],
        },
      ]}
    />
  );
}

const kinds: [IconName, string][] = [
  ['code', 'Software change'],
  ['text', 'Docs pass'],
  ['search', 'Research'],
];

const depths: [string, string[]][] = [
  ['quick', ['edit', 'check', 'commit']],
  ['standard', ['plan', 'test', 'one review']],
  ['deep', ['spec', 'tickets', 'review rounds']],
];

export function DepthMap(): ReactNode {
  return (
    <figure className={styles.figure}>
      <div className={styles.depthMap}>
        <p className={styles.chip}>
          <Icon name="tag" /> Task
        </p>
        <Icon name="arrow" className={styles.joint} />
        <div className={styles.column}>
          <p className={styles.columnHead}>Kind</p>
          <ul className={styles.chips}>
            {kinds.map(([icon, name]) => (
              <li key={name} className={styles.chip}>
                <Icon name={icon} /> {name}
              </li>
            ))}
          </ul>
        </div>
        <Icon name="arrow" className={styles.joint} />
        <div className={styles.column}>
          <p className={styles.columnHead}>Depth</p>
          <ul className={styles.depths}>
            {depths.map(([name, steps], level) => (
              <li key={name} className={styles.depth}>
                <span className={styles.meter} aria-hidden="true">
                  {depths.map(([d], i) => (
                    <span key={d} className={clsx(i <= level && styles.filled)} />
                  ))}
                </span>
                <strong>{name}</strong>
                <ol className={styles.pills}>
                  {steps.map((st) => (
                    <li key={st}>{st}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <figcaption>Each task gets a kind, then a depth that sets its steps.</figcaption>
    </figure>
  );
}

type Lane = 'you' | 'coordinator' | 'worker' | 'reviewer';
const lanes: [Lane, string, IconName][] = [
  ['you', 'You', 'person'],
  ['coordinator', 'Coordinator', 'layers'],
  ['worker', 'Worker', 'code'],
  ['reviewer', 'Reviewer', 'eye'],
];
const laneIndex = (l: Lane) => lanes.findIndex(([key]) => key === l);
const laneName = (l: Lane) => lanes[laneIndex(l)][1];

// [from, to, text, reply]: a reply answers the message before it and is drawn dashed.
const messages: [Lane, Lane, string, boolean][] = [
  ['you', 'coordinator', 'label issues, start the run', false],
  ['coordinator', 'worker', 'spec, own worktree', false],
  ['worker', 'coordinator', 'draft pull request', true],
  ['coordinator', 'reviewer', 'review the head', false],
  ['reviewer', 'coordinator', 'findings', true],
  ['coordinator', 'worker', 'Blocking and Important findings', false],
  ['worker', 'coordinator', 'fix pushed', true],
  ['coordinator', 'reviewer', 're-review the fix', false],
  ['reviewer', 'coordinator', 'clean', true],
  ['coordinator', 'coordinator', 'checks green, merge by the policy', false],
];

export function BuildToMerge(): ReactNode {
  return (
    <figure className={styles.figure}>
      <div className={styles.exchange}>
        <ul className={styles.lanes}>
          {lanes.map(([key, name, icon]) => (
            <li key={key} className={clsx(key === 'you' && styles.you)}>
              <span className={styles.laneDisc}>
                <Icon name={icon} />
              </span>
              {name}
            </li>
          ))}
        </ul>
        <ol className={styles.messages}>
          {messages.map(([from, to, text, reply], i) => {
            const a = laneIndex(from);
            const b = laneIndex(to);
            // A message to the sender's own lane is a box from that lane to the right edge.
            const style = (
              a === b
                ? {gridColumn: `${a + 1} / -1`, '--span': lanes.length - a}
                : {gridColumn: `${Math.min(a, b) + 1} / ${Math.max(a, b) + 2}`, '--span': Math.abs(a - b) + 1}
            ) as CSSProperties;
            return (
              <li
                key={text}
                style={style}
                className={clsx(a === b ? styles.self : a < b ? styles.right : styles.left, reply && styles.reply)}>
                <span className={styles.message}>
                  <span className={styles.seq}>{i + 1}</span>
                  <span className={styles.srOnly}>
                    {a === b ? `${laneName(from)}: ` : `${laneName(from)} to ${laneName(to)}${reply ? ', reply' : ''}: `}
                  </span>
                  {text}
                </span>
                <span className={styles.line} aria-hidden="true" />
              </li>
            );
          })}
        </ol>
      </div>
      <figcaption>Build to merge, top to bottom. Dashed arrows are replies.</figcaption>
    </figure>
  );
}
