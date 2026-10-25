export const example = [
  { path: 'package.json', content: '{"type":"module"}' },
  { path: 'src/add.js', content: 'export const add = (a,b) => a+b;' },
  { path: 'src/text.js', content: 'export const upper = text => text.toUpperCase();' },
  { path: 'test/add.test.js', content: "import test from 'node:test'; import assert from 'node:assert/strict'; import {add} from '../src/add.js'; test('add',()=>assert.equal(add(1,2),3));" },
  { path: 'test/text.test.js', content: "import test from 'node:test'; import assert from 'node:assert/strict'; import {upper} from '../src/text.js'; test('upper',()=>assert.equal(upper('a'),'A'));" },
];
