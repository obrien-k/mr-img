const { chapterList } = require('./chapters.js');

function attrs(obj) {
  return Object.entries(obj).map(([k, v]) => ` ${k}="${v}"`).join('');
}

// One disc plan -> the dvdauthor XML that builds it.
function dvdauthorXml(disc) {
  const lines = [`<dvdauthor dest="${disc.dir}">`, '  <vmgm>'];
  if (disc.fpc) lines.push(`    <fpc>${disc.fpc}</fpc>`);
  lines.push('  </vmgm>');

  for (const ts of disc.titlesets) {
    lines.push('  <titleset>', '    <titles>');
    lines.push(`      <video${attrs(ts.video)}/>`);
    for (const a of ts.audio || []) lines.push(`      <audio${attrs(a)}/>`);
    for (const s of ts.subpicture || []) lines.push(`      <subpicture${attrs(s)}/>`);
    for (const pgc of ts.pgcs) {
      lines.push('      <pgc>');
      for (const vob of pgc.vobs) {
        lines.push(`        <vob file="${vob.file}" chapters="${chapterList(vob.chapterDurationsMs)}"/>`);
      }
      if (pgc.post) lines.push(`        <post>${pgc.post}</post>`);
      lines.push('      </pgc>');
    }
    lines.push('    </titles>', '  </titleset>');
  }

  lines.push('</dvdauthor>');
  return lines.join('\n') + '\n';
}

module.exports = { dvdauthorXml };
