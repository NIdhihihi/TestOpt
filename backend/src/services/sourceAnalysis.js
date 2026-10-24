import { createHash } from 'node:crypto';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { parse } from '@babel/parser';

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
export const isTestFile = name => /\.(test|spec)\.(js|mjs|cjs)$/.test(name);
export const isCodeFile = name => /\.(js|mjs|cjs)$/.test(name);
export const fingerprint = text => createHash('sha256').update(text).digest('hex');

export function validateSourceFiles(input) {
  if (!Array.isArray(input) || !input.length || input.length > 300) throw new Error('Upload between 1 and 300 source files.');
  let bytes = 0;
  const seen = new Set();
  return input.map(file => {
    const name = file?.path;
    if (typeof name !== 'string' || name.length > 240 || !name || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Every source path must be a safe relative path.');
    if (name.split('/').some(part => /^(\.git|node_modules|\.env(?:\..*)?|dist|build|coverage|\.ssh|\.aws)$/i.test(part)) || /\.(pem|key|p12|pfx)$/i.test(name)) throw new Error(`Excluded or sensitive file: ${name}`);
    if (!/\.(js|mjs|cjs|json|md|txt|ts|tsx|jsx)$/.test(name) || typeof file.content !== 'string' || file.content.includes('\0')) throw new Error(`Unsupported text file: ${name}`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate source path: ${name}`);
    seen.add(key);
    const size = Buffer.byteLength(file.content);
    bytes += size;
    if (size > 512 * 1024 || bytes > 5 * 1024 * 1024) throw new Error('Limit: 512 KB per file and 5 MB per project.');
    return { path: name, content: file.content, hash: fingerprint(file.content) };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function analyzeSource(files, previousFiles = []) {
  const byPath = new Map(files.map(file => [file.path, file]));
  const old = new Map(previousFiles.map(file => [file.path, file]));
  const warnings = [];
  const unsupported = [];
  let manifest = {};
  try { manifest = JSON.parse(byPath.get('package.json')?.content || '{}'); } catch { unsupported.push('package.json is invalid JSON.'); }
  if (!byPath.has('package.json')) unsupported.push('Upload a project folder with package.json at its root.');
  if (Object.keys(manifest.dependencies || {}).length || Object.keys(manifest.devDependencies || {}).length) unsupported.push('This adapter supports dependency-free node:test projects; package installation is not enabled.');
  if (manifest.imports || manifest.exports) warnings.push('Package import/export maps require full validation.');
  const tests = files.filter(file => isTestFile(file.path)).map(file => file.path);
  if (!tests.length) unsupported.push('No *.test.js, *.test.mjs, *.test.cjs, or *.spec.* files found.');
  if (files.some(file => /\.(ts|tsx|jsx)$/.test(file.path))) unsupported.push('TypeScript/JSX requires another adapter.');
  const dependencies = [];
  for (const file of files.filter(file => isCodeFile(file.path))) {
    let ast;
    try { ast = parse(file.content, { sourceType: 'unambiguous', createImportExpressions: true }); }
    catch { unsupported.push(`JavaScript could not be parsed: ${file.path}`); continue; }
    if (isTestFile(file.path) && !/(?:node:test|require\(['"]test['"]\))/.test(file.content)) unsupported.push(`Test framework is not confirmed as node:test: ${file.path}`);
    const refs = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) refs.push(node.source.value);
      if (node.type === 'ImportExpression') {
        warnings.push(`Dynamic import in ${file.path}; broaden validation.`);
        if (node.source.type === 'StringLiteral') refs.push(node.source.value);
      }
      if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') {
        if (node.arguments[0]?.type === 'StringLiteral') refs.push(node.arguments[0].value);
        else warnings.push(`Computed require in ${file.path}; broaden validation.`);
      }
      if ((node.type === 'CallExpression' && node.callee?.type === 'Identifier' && ['eval', 'Function'].includes(node.callee.name)) || (node.type === 'NewExpression' && node.callee?.name === 'Function')) warnings.push(`Generated code in ${file.path}; broaden validation.`);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value);
      }
    }
    visit(ast.program);
    for (const ref of new Set(refs)) {
      if (builtins.has(ref.replace(/^node:/, ''))) {
        if (/^(node:)?(fs|child_process|worker_threads|module)(\/|$)/.test(ref)) warnings.push(`Runtime file/process access in ${file.path}; broaden validation.`);
        continue;
      }
      if (!ref.startsWith('.')) { unsupported.push(`External dependency ${ref} in ${file.path}.`); continue; }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), ref));
      const resolved = [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, `${target}/index.js`].find(candidate => byPath.has(candidate));
      if (!resolved) warnings.push(`Unresolved import ${ref} in ${file.path}; broaden validation.`);
      else dependencies.push({ source: file.path, target: resolved });
    }
  }
  const changes = {
    added: files.filter(file => !old.has(file.path)).map(file => file.path),
    modified: files.filter(file => old.has(file.path) && old.get(file.path).hash !== file.hash).map(file => file.path),
    deleted: previousFiles.filter(file => !byPath.has(file.path)).map(file => file.path),
  };
  const coverage = {};
  for (const test of tests) {
    const seen = new Set([test]);
    const stack = [test];
    while (stack.length) {
      const source = stack.pop();
      for (const edge of dependencies.filter(edge => edge.source === source)) if (!seen.has(edge.target)) { seen.add(edge.target); stack.push(edge.target); }
    }
    coverage[test] = [...seen].filter(name => !isTestFile(name));
  }
  return { assumptions: ['Discovered modules use default criticality 5/10 and test files use MEDIUM priority; durations are learned from actual executions.'], adapter: 'NODE_TEST_FILES', supported: !unsupported.length, unsupported: [...new Set(unsupported)], warnings: [...new Set(warnings)], tests, modules: files.filter(file => isCodeFile(file.path) && !isTestFile(file.path)).map(file => file.path), dependencies, coverage, changes };
}
