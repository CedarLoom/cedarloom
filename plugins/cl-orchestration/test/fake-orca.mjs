#!/usr/bin/env node
// A fake orca, also the evals' fake gh: `fake-orca.mjs <program> <args...>` answers an argv listed exactly in `.fake/<program>.json`
// ([[args, stdout, exit code]...]) of the nearest `.fake/` folder from its working folder up, and fails any other argv, so a call that
// differs in a flag, its order or a value shows as "not faked". Every call is logged to `.fake/<program>-calls.jsonl` as { cwd, args }.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [program, ...args] = process.argv.slice(2);
if (!program) {
  process.stderr.write('usage: fake-orca.mjs <program> <args...>\n');
  process.exit(2);
}

let dir = process.cwd();
while (!existsSync(join(dir, '.fake')) && dirname(dir) !== dir) dir = dirname(dir);
const fake = join(dir, '.fake');
if (!existsSync(fake)) {
  process.stderr.write(`${program} is faked here, and no .fake folder is above ${process.cwd()}\n`);
  process.exit(1);
}

appendFileSync(join(fake, `${program}-calls.jsonl`), `${JSON.stringify({ cwd: process.cwd(), args })}\n`);
const answers = join(fake, `${program}.json`);
/** @type {[string[], string, number?][]} */
const list = existsSync(answers) ? JSON.parse(readFileSync(answers, 'utf8')) : [];
const hit = list.find(([listed]) => JSON.stringify(listed) === JSON.stringify(args));
if (!hit) {
  process.stderr.write(`not faked: ${program} ${args.join(' ')}\n`);
  process.exit(1);
}
process.stdout.write(hit[1]);
process.exit(hit[2] ?? 0);
