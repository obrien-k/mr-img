// Every external command goes through here: printed, appended to the
// workdir's commands.sh, and tracked so a signal can stop it.
const { spawn } = require('child_process');
const fs = require('fs');

let current = null;
let logFile = null;

const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
const show = (cmd, args) => [cmd, ...args].map(shq).join(' ');

function setCommandLog(file) {
  logFile = file;
  fs.writeFileSync(file, '#!/bin/sh\n# Commands run by audio-cd, in order.\n');
}

// stream: echo the child's output live (cdrdao progress), still captured.
function run(cmd, args, { cwd, stream = false, echo = true } = {}) {
  const line = show(cmd, args);
  if (echo) process.stdout.write(`$ ${line}\n`);
  if (logFile) fs.appendFileSync(logFile, `${cwd ? `(cd ${shq(cwd)} && ${line})` : line}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    let out = '';
    const take = (dest) => (chunk) => {
      if (out.length < 4 << 20) out += chunk;
      if (stream) dest.write(chunk);
    };
    child.stdout.on('data', take(process.stdout));
    child.stderr.on('data', take(process.stderr));
    child.on('error', (err) => { current = null; reject(err); });
    child.on('close', (code, signal) => { current = null; resolve({ code: code ?? 128, signal, out }); });
  });
}

function killCurrent(signal) {
  if (current) current.kill(signal);
}

module.exports = { run, setCommandLog, killCurrent, show, shq };
