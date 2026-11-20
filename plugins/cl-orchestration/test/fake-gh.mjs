import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A gh program in dir/bin that answers each argv listed in answers ([[args, stdout, exit code]...]) and fails any other, logging every call's working folder and argv. Returns { bin, answer(answers), calls() }, calls() as [{ cwd, args }...].
export function fakeGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const answers = join(bin, 'answers.json'), log = join(bin, 'calls.jsonl');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
const hit = JSON.parse(readFileSync(${JSON.stringify(answers)}, 'utf8')).find(([a]) => JSON.stringify(a) === JSON.stringify(args));
if (!hit) { process.stderr.write('not faked: ' + args.join(' ') + '\\n'); process.exit(1); }
process.stdout.write(hit[1]);
process.exit(hit[2] ?? 0);
`, { mode: 0o755 });
  const answer = (list) => writeFileSync(answers, JSON.stringify(list));
  answer([]);
  return { bin, answer, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}
