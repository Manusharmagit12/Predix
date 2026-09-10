const fs = require('fs');
const path = require('path');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const appJs = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '')
  .replace('</body>', () => '<script>' + appJs + '</script></body>');
const dom = new JSDOM(html, {
  url: 'http://localhost:3000/', runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(w) {
    w.EventSource = class { constructor() {} close() {} addEventListener() {} };
    w.scrollTo = () => {};
    w.fetch = (url, opts) => fetch('http://localhost:3000' + url, opts);
  }
});
const w = dom.window;
setTimeout(async () => {
  await w.eval('viewMarket("will-mumbai-indians-qualify-for-the-ipl-2027-playoffs")');
  await new Promise(r => setTimeout(r, 600));
  console.log('Error text:', w.document.querySelector('.card-pad')?.textContent);
  process.exit(0);
}, 600);
