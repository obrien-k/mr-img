const download = require('./download.js')
const url = 'https://media-cldnry.s-nbcnews.com/image/upload/t_fit-1240w,f_auto,q_auto:best/streams/2013/March/130326/1C6639340-google-logo.jpg'
console.log('Downloading ' + url)

async function run() {
  console.log('Downloading file')
  try {
    await download(url)
    console.log('Download done')
  } catch (e) {
    console.log('Download failed')
    console.log(e.message)
  }
}

run()