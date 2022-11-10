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
    dest = './tmp/' + basename(uri.pathname)
  }
  const pkg = url.toLowerCase().startsWith('https:') ? https : http

  return new Promise((resolve, reject) => {
    const request = pkg.get(uri.href).on('response', (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest, { flags: 'wx' })
        res
          .on('end', () => {
            
            file.end()
            imageMetadata(dest).then(() => {
              file.destroy()
              fs.unlink(dest, () => reject())
            })
            
            //console.log(`${uri.pathname} downloaded to: ${path}`)
            resolve()
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
  })
}

module.exports = download