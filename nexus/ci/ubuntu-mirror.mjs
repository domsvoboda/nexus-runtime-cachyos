// CI runners only: keep the Ubuntu suites, signing keys and third-party sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ubuntuUrl = /https?:\/\/(azure\.archive|archive|security)\.ubuntu\.com\/ubuntu(?=[\s/]|$)/g;
export function officialUbuntuMirrors(source) {
  return source.replace(ubuntuUrl, (_url, host) =>
    `https://${host === 'security' ? 'security' : 'archive'}.ubuntu.com/ubuntu`);
}

export async function configureUbuntuMirrors(root = '/etc/apt') {
  const names = ['sources.list', 'apt-mirrors.txt', 'apt-mirrors-security.txt'];
  try {
    for (const entry of await fs.readdir(path.join(root, 'sources.list.d'))) {
      if (/\.(?:list|sources)$/.test(entry)) names.push(path.join('sources.list.d', entry));
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const plans = [];
  let recognized = false;
  for (const name of names) {
    const file = path.join(root, name);
    let stat;
    try { stat = await fs.lstat(file); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile()) throw Error(`APT source must be a regular file: ${name}`);
    const source = await fs.readFile(file, 'utf8');
    recognized ||= /https?:\/\/(?:azure\.archive|archive|security)\.ubuntu\.com\/ubuntu(?=[\s/]|$)/.test(source);
    const updated = officialUbuntuMirrors(source);
    if (source !== updated) plans.push({ file, updated });
  }
  if (!recognized) throw Error('No supported Ubuntu APT mirror configuration found.');
  for (const { file, updated } of plans) await fs.writeFile(file, updated);
  return plans.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = await configureUbuntuMirrors();
  console.log(`Official Ubuntu HTTPS mirrors configured (${changed} source files updated).`);
}
