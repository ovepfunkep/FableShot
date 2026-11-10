// Own-app-only device checks. No contacts, messages, gallery or unrelated app data.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const adb = path.join(root, '.tools', 'android', 'platform-tools', 'adb.exe');
const pkg = 'app.fableshot.android.dev';
const [serial, action, ...params] = process.argv.slice(2);
if (!serial || !action) throw new Error('Usage: node scripts/android-device.cjs SERIAL ACTION [ARGS]');
const directory = path.join(root, '.tools', 'device-check');
fs.mkdirSync(directory, { recursive: true });
function run(args, binary = false) {
  return execFileSync(adb, ['-s', serial, ...args], { encoding: binary ? undefined : 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024, windowsHide: true });
}
function ownScreen() {
  const windows = run(['shell', 'dumpsys', 'window']);
  const focus = windows.split('\n').find(line => line.includes('mCurrentFocus='));
  if (!focus || !focus.includes(pkg + '/')) throw new Error('FableShot is not foreground; refusing screen/input operation.');
}
function unescapeXml(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function layout() {
  ownScreen();
  run(['shell', 'uiautomator', 'dump', '/data/local/tmp/fableshot-window.xml']);
  const xml = run(['exec-out', 'cat', '/data/local/tmp/fableshot-window.xml']);
  fs.writeFileSync(path.join(directory, 'ui-latest.xml'), xml);
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map(match => Object.fromEntries([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => [a[1], unescapeXml(a[2])])));
  return nodes.filter(n => n.package === pkg);
}
function center(bounds) {
  const n = bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.slice(1).map(Number);
  if (!n || n[2] <= n[0] || n[3] <= n[1]) throw new Error('Element has no visible bounds');
  return [Math.round((n[0] + n[2]) / 2), Math.round((n[1] + n[3]) / 2)];
}
switch (action) {
  case 'launch': console.log(run(['shell', 'am', 'start', '-W', '-n', pkg + '/app.fableshot.android.MainActivity'])); break;
  case 'stop': console.log(run(['shell', 'am', 'force-stop', pkg])); break;
  case 'layout': console.log(JSON.stringify(layout().filter(n => n.text || n['content-desc'] || n['resource-id']).map(n => ({ text: n.text, id: n['resource-id'], description: n['content-desc'], bounds: n.bounds, enabled: n.enabled, clickable: n.clickable })), null, 2)); break;
  case 'tap': {
    const query = params[0];
    const nodes = layout();
    const found = nodes.find(n => n['resource-id'] === query || n['resource-id']?.endsWith(':id/' + query)) || nodes.find(n => n.text === query);
    if (!found || found.enabled === 'false') throw new Error('No enabled element: ' + query);
    console.log(run(['shell', 'input', 'tap', ...center(found.bounds).map(String)]));
    break;
  }
  case 'tap-xy': {
    ownScreen();
    if (params.length !== 2 || params.some(p => !/^\d{1,4}$/.test(p))) throw new Error('Expected numeric coordinates');
    console.log(run(['shell', 'input', 'tap', ...params]));
    break;
  }
  case 'text': {
    ownScreen();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(params[0] || '')) throw new Error('Only simple test text accepted');
    console.log(run(['shell', 'input', 'text', params[0]]));
    break;
  }
  case 'back': ownScreen(); console.log(run(['shell', 'input', 'keyevent', 'KEYCODE_BACK'])); break;
  case 'screenshot': {
    ownScreen();
    const file = path.join(directory, 'screen-latest.png');
    fs.writeFileSync(file, run(['exec-out', 'screencap', '-p'], true));
    console.log(file); break;
  }
  case 'database': {
    run(['shell', 'am', 'force-stop', pkg]);
    for (const name of ['fableshot.db', 'fableshot.db-wal', 'fableshot.db-shm']) {
      const data = run(['exec-out', 'run-as', pkg, 'cat', 'databases/' + name], true);
      fs.writeFileSync(path.join(directory, name), data);
    }
    console.log(directory); break;
  }
  default: throw new Error('Unknown own-app action');
}
