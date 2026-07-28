// download.js
const http = require('http');
const https = require('https');
const fs = require('fs');
const { basename } = require('path');
const { URL } = require('url');

const TIMEOUT = 30000;

function download(url, dest) {
  const uri = new URL(url);
  if (!dest) {
    dest = __dirname + '/tmp/' + basename(uri.pathname);
  }
  const pkg = url.toLowerCase().startsWith('https:') ? https : http;

  return new Promise((resolve, reject) => {
    fs.mkdir(__dirname + '/tmp', { recursive: true }, (err) => {
      if (err) return reject(err);
      checkExisting();
    });

    function checkExisting() {
      fs.access(dest, fs.constants.F_OK, (err) => {
        if (!err) {
          // File already exists, overwrite it
          fs.unlink(dest, (err) => {
            if (err) {
              reject(err);
            } else {
              downloadFile();
            }
          });
        } else {
          // File does not exist, download it
          downloadFile();
        }
      });
    }

    function downloadFile() {
      const request = pkg.get(uri.href).on('response', (res) => {
        if (res.statusCode === 200) {
          const file = fs.createWriteStream(dest, { flags: 'wx' });
          res
            .on('end', () => {
              file.end();
              resolve(dest);
            })
            .on('error', (err) => {
              file.destroy();
              fs.unlink(dest, () => reject(err));
            }).pipe(file);
        } else if (res.statusCode === 302 || res.statusCode === 301) {
          // Recursively follow redirects, only a 200 will resolve.
          download(res.headers.location, dest).then(resolve, reject);
        } else {
          reject(new Error(`Download request failed, response status: ${res.statusCode} ${res.statusMessage}`));
        }
      });
      request.setTimeout(TIMEOUT, () => {
        request.destroy();
        reject(new Error(`Request timeout after ${TIMEOUT / 1000.0}s`));
      });
      request.on('error', (err) => {
        reject(new Error(`Error downloading image: ${err.message}`));
      });
    }
  });
}

module.exports = download;
