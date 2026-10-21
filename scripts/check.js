// 结构/路由/绑定/JavaScript 静态检查；不替代微信开发者工具 WXML 编译。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../miniprogram');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]); }
const all = files(root);
for (const file of all) {
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) JSON.parse(source);
  if (file.endsWith('.js')) new vm.Script(source, { filename: file });
  if (file.endsWith('.wxml')) {
    const js = fs.readFileSync(file.replace('.wxml', '.js'), 'utf8');
    for (const binding of source.matchAll(/(?:bind|catch):?[a-z]+="([a-zA-Z][\w]*)"/g)) assert.match(js, new RegExp(`\\b${binding[1]}\\s*[:(]`), `${file}: missing handler ${binding[1]}`);
    // 跳过引号内的 > 和模板表达式中的比较符。
    const clean = source.replace(/"[^"]*"/g, '""').replace(/{{[\s\S]*?}}/g, 'EXPR');
    const stack = [];
    for (const tag of clean.matchAll(/<(\/)?([\w-]+)\b[^>]*?(\/?)>/g)) {
      if (tag[1]) assert.equal(stack.pop(), tag[2], `Unbalanced tag in ${file}`);
      else if (!tag[3]) stack.push(tag[2]);
    }
    assert.equal(stack.length, 0, `Unclosed tags in ${file}`);
  }
}
const app = require(path.join(root, 'app.json'));
for (const page of app.pages) for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.ok(fs.existsSync(path.join(root, `${page}.${extension}`)), `Missing ${page}.${extension}`);
for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath));
for (const component of Object.values(app.usingComponents)) assert.ok(fs.existsSync(path.join(root, component + '.json')));
for (const file of all.filter(file => file.endsWith('.js'))) for (const route of fs.readFileSync(file, 'utf8').matchAll(/\/pages\/([\w-]+)\/index/g)) assert.ok(app.pages.includes(`pages/${route[1]}/index`), `Unknown route ${route[0]}`);
console.log(`PASS: ${app.pages.length} pages; JSON, JavaScript, WXML tag structure, routes and event handlers checked`);
