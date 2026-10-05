#!/usr/bin/env node
const fs = require('fs');
const { buildScript } = require('../dvd/script.js');
const { chapterList } = require('../dvd/chapters.js');
const { parseChapterDurations, parseTitleDurations, parseTitleSets } = require('../dvd/parse.js');

const USAGE = `usage: dvd <command> <file>
  script <recipe.json>         print the bash script that builds every disc in the recipe
  chapters <handbrake-scan>    dvdauthor chapters="" value from one title's HandBrakeCLI --scan output
  titles <handbrake-scan>      JSON title durations from HandBrakeCLI -t 0 --scan output
  titlesets <dvdbackup-I>      JSON title-set layout from dvdbackup -I output
  (file "-" reads stdin)`;

const [cmd, file] = process.argv.slice(2);
if (!cmd || !file) {
  console.error(USAGE);
  process.exit(2);
}
const input = fs.readFileSync(file === '-' ? 0 : file, 'utf8');

switch (cmd) {
  case 'script':
    process.stdout.write(buildScript(JSON.parse(input)));
    break;
  case 'chapters':
    console.log(chapterList(parseChapterDurations(input)));
    break;
  case 'titles':
    console.log(JSON.stringify(parseTitleDurations(input), null, 2));
    break;
  case 'titlesets':
    console.log(JSON.stringify(parseTitleSets(input), null, 2));
    break;
  default:
    console.error(USAGE);
    process.exit(2);
}
