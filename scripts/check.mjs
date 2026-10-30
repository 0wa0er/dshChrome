import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname,'..');
async function scan(directory) {
  const files=[];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    if (entry.isDirectory()) files.push(...await scan(path.join(directory,entry.name)));
    else if (/\.(m?js)$/.test(entry.name)) files.push(path.join(directory,entry.name));
  }
  return files;
}
for (const directory of ['host','shared','native','extension','install','scripts']) {
  for (const file of await scan(path.join(root,directory))) {
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
  }
}
const manifest=JSON.parse(await readFile(path.join(root,'extension/manifest.json'),'utf8'));
const release=JSON.parse(await readFile(path.join(root,'release.json'),'utf8'));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const digest=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32);
assert.equal(digest.replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16))),release.extensionId);
assert.equal(manifest.version,release.version);assert.equal(pkg.version,release.version);
assert.equal(manifest.manifest_version,3);assert.equal(manifest.background.type,'module');
for (const file of [manifest.background.service_worker,manifest.side_panel.default_path]) await stat(path.join(root,'extension',file));
for (const file of ['host/index.js','native/main.js',pkg.dsh.bundle.patch]) await stat(path.join(root,file));
assert.ok(!manifest.host_permissions?.includes('<all_urls>'),'Selection capture should use activeTab, not broad persistent host grants');
console.log('Syntax, package entry points, versions and stable Chrome ID verified.');
