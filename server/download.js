// download.js
const http = require('http'); 
const https = require('https'); 
const fs = require('fs');
const { basename } = require('path');
const { URL } = require('url');
const imageMetadata = require('./metadata.js')

const TIMEOUT = 10000

function download (url, dest) {
  const uri = new URL(url);


  if (!dest) {
    dest = __dirname + '/tmp/' + basename(uri.pathname)
  }

  const dirname = dest.substring(0, dest.lastIndexOf('/'));
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }

  if (fs.existsSync(dest)) {
    console.log(`File ${dest} already exists. Skipping download.`);
    return Promise.resolve();
  }

  const pkg = url.toLowerCase().startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const request = pkg.get(uri.href).on('response', (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest, { flags: 'wx' });
        const len = parseInt(res.headers['content-length'], 10);
        let downloaded = 0;
        let percent = 0;
        res
<<<<<<< HEAD
          .on('data', function(chunk) {
            try {
              file.write(chunk);
              downloaded += chunk.length;
              percent = (100.0 * downloaded / len).toFixed(2);
              process.stdout.write(
                `Downloading ${percent}% ${downloaded} bytes\r`
              );
            } catch (error) {
              file.destroy();
              fs.unlink(dest, () => reject(error));
            }
          })
          .on('end', function() {
            file.end();
            resolve();
=======
          .on('end', () => {
            file.end()
            imageMetadata(dest).then(() => {
              console.log(dest + 'file created');
              resolve()
            })
            
            //console.log(`${uri.pathname} downloaded to: ${path}`)
            resolve()
>>>>>>> 05771246b81cf2cdc2c16448d872a46423776b46
          })
          .on('error', (err) => {
            file.destroy();
            fs.unlink(dest, () => reject(err));
          }).pipe(file);
      } else if (res.statusCode === 302 || res.statusCode === 301) {
        // Recursively follow redirects, only a 200 will resolve.
        download(res.headers.location, dest).then(() => resolve());
      } else {
        reject(
          new Error(
            `Download request failed, response status: ${res.statusCode} ${res.statusMessage}`
          )
        );
      }
    });
    request.setTimeout(TIMEOUT, function() {
      request.abort();
      reject(new Error(`Request timeout after ${TIMEOUT / 1000.0}s`));
    });
  });
}

module.exports = download