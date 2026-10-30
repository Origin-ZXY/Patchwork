// Bundle local, relative ESM modules without runtime dependencies.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = {};
const textTypes = new Set(['.html', '.css', '.js', '.svg', '.json']);
function collect(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.') || ['server', 'worker', 'scripts', 'tests', 'db', 'drizzle', 'dist', 'node_modules', 'docs'].includes(item.name)) continue;
    const path = resolve(directory, item.name);
    if (item.isDirectory()) { if (['assets', 'online'].includes(item.name) || directory !== project) collect(path); }
    else if (textTypes.has(extname(path)) && !['package.json', 'package-lock.json'].includes(item.name)) {
      assets['/' + relative(project, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8');
    }
  }
}
collect(project);
assert.ok(assets['/index.html'], 'The main game page must exist before building.');

const modules = new Map();
let output = '// Generated single-module Patchwork Worker. Run npm run build to rebuild.\n';
function compile(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file);
  const identifier = '__module' + modules.size;
  modules.set(file, identifier);
  let source = readFileSync(file, 'utf8');
  const bindings = [];
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, specifier, path) => {
    assert.ok(path.startsWith('.'), `Worker imports must be local: ${path}`);
    const dependency = compile(resolve(dirname(file), path));
    const imported = specifier.trim();
    if (imported.startsWith('{')) bindings.push(`const ${imported.replace(/\bas\b/g, ':')}=${dependency};`);
    else if (imported.startsWith('* as ')) bindings.push(`const ${imported.slice(5).trim()}=${dependency};`);
    else throw new Error(`Unsupported default import in ${file}: ${specifier}`);
    return '';
  });
  const exported = [...source.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/g)].map(match => match[1]);
  source = source.replace(/\bexport\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/g, '');
  source = source.replace(/\bexport\s*\{([^}]+)\};?/g, (_, names) => {
    for (const name of names.split(',').map(s => s.trim()).filter(Boolean)) {
      const [local, alias] = name.split(/\s+as\s+/);
      exported.push(alias ? `${alias}:${local}` : local);
    }
    return '';
  });
  assert.ok(!/^import\b|\bexport\s+default\b/m.test(source), `Unsupported module syntax in ${file}`);
  output += `const ${identifier}=(()=>{\n${bindings.join('\n')}\n${source}\nreturn {${exported.join(',')}};\n})();\n`;
  return identifier;
}
const runtime = compile(resolve(project, 'worker/index.js'));
output += `const __assets=${JSON.stringify(assets)};\nexport default ${runtime}.createWorker(__assets);\n`;
const destination = resolve(project, 'dist/server');
mkdirSync(destination, { recursive: true });
writeFileSync(resolve(destination, 'index.js'), output);
const manifest = resolve(project, '.openai/hosting.json');
if (existsSync(manifest)) {
  mkdirSync(resolve(project, 'dist/.openai'), { recursive: true });
  copyFileSync(manifest, resolve(project, 'dist/.openai/hosting.json'));
}
const built = await import(pathToFileURL(resolve(destination, 'index.js')).href + '?build=' + Date.now());
assert.equal(typeof built.default.fetch, 'function');
assert.ok(!Object.keys(assets).some(path => /^\/(?:server|worker|tests|db|\.openai)\//.test(path)));
console.log(`Built Patchwork Worker: ${Object.keys(assets).length} embedded assets, ${Buffer.byteLength(output)} bytes.`);
