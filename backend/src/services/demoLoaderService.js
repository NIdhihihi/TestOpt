import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSource, validateSourceFiles } from './sourceAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SHOPCART_DEMO_DIR = path.resolve(__dirname, '../../../examples/shopcart-demo/v1-baseline');

async function collectFiles(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath, relPath)));
    } else if (entry.isFile()) {
      const content = await fs.readFile(fullPath, 'utf8');
      results.push({ path: relPath, content });
    }
  }
  return results;
}

/**
 * Loads and validates the bundled ShopCart baseline demo files for isolated org onboarding.
 */
export async function loadShopcartDemoPackage(demoDir = SHOPCART_DEMO_DIR) {
  const rawFiles = await collectFiles(demoDir);
  const files = validateSourceFiles(rawFiles);
  const analysis = analyzeSource(files, []);
  return { files, analysis };
}

