// download.js
const http = require('http'); 
const https = require('https'); 
const fs = require('fs');
const { basename } = require('path');
const { URL } = require('url');
const imageMetadata = require('./metadata.js')

const TIMEOUT = 10000

function download (url, dest) {
  const uri = new URL(url)
  if (!dest) {
    dest = __dirname + '/tmp/' + basename(uri.pathname)
  }
  const pkg = url.toLowerCase().startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    fs.access(dest, fs.constants.F_OK, (err) => {
      if (!err) {
        // File already exists, overwrite it
        fs.unlink(dest, (err) => {
          if (err) {
            reject(err)
          } else {
            downloadFile()
          }
        })
      } else {
        // File does not exist, download it
        downloadFile()
      }
    })

    function downloadFile() {
      const request = pkg.get(uri.href).on('response', (res) => {
        if (res.statusCode === 200) {
          const file = fs.createWriteStream(dest, { flags: 'wx' })
          res
            .on('end', () => {
              file.end()
              imageMetadata(dest)
                .then(() => {
                  console.log(dest + ' file created');
                  resolve()
                })
                .catch((err) => {
                  console.error(`Error extracting metadata for ${dest}: ${err.message}`)
                  reject(err)
                })
            })
            .on('error', (err) => {
              file.destroy()
              fs.unlink(dest, () => reject(err))
            }).pipe(file)
        } else if (res.statusCode === 302 || res.statusCode === 301) {
          // Recursively follow redirects, only a 200 will resolve.
          download(res.headers.location, dest).then(() => resolve())
        } else {
          reject(new Error(`Download request failed, response status: ${res.statusCode} ${res.statusMessage}`))
        }
      })
      request.setTimeout(TIMEOUT, function () {
        request.abort()
        reject(new Error(`Request timeout after ${TIMEOUT / 1000.0}s`))
      })
    }
  })
}

module.exports = download
