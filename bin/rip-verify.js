#!/usr/bin/env node
// rip-verify <rip-dir> [--out manifest.json]  — exit 0 pass, 1 fail, 3 incomplete, 2 usage
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { verifyRip } = require('../rip/verify.js');

const USAGE = 'usage: rip-verify <rip-dir> [--out manifest.json]';
let args;
try {
  args = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
} catch (e) {
  console.error(`${e.message}\n${USAGE}`);
  process.exit(2);
}
if (args.values.help || args.positionals.length !== 1) {
  console.error(USAGE);
  process.exit(args.values.help ? 0 : 2);
}
const dir = args.positionals[0];
const out = args.values.out && path.resolve(args.values.out);
if (out && path.dirname(out).startsWith(fs.realpathSync(dir))) {
  console.error('rip-verify: --out must be outside the rip directory');
  process.exit(2);
}

verifyRip(dir).then((m) => {
  for (const c of m.checks) console.error(`${c.status.toUpperCase().padEnd(4)} ${c.name.padEnd(18)} ${c.detail}`);
  console.error(`verdict: ${m.verdict}`);
  const json = `${JSON.stringify(m, null, 2)}\n`;
  if (out) fs.writeFileSync(out, json);
  else process.stdout.write(json);
  process.exitCode = { pass: 0, fail: 1, incomplete: 3 }[m.verdict];
}).catch((e) => {
  console.error(`rip-verify: ${e.message}`);
  process.exitCode = 1;
});
