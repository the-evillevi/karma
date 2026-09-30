#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeCatalog, validateCatalog } from './catalog-normalizer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(root, 'catalog', 'catalog.json');
const checkOnly = process.argv.includes('--check');

globalThis.window = {};
await import(path.join(root, 'src/karma-data.js'));
const catalog = normalizeCatalog(globalThis.window.KARMA);
const result = validateCatalog(catalog);
if (result.errors.length) {
  console.error(result.errors.join('\n'));
  process.exitCode = 1;
} else {
  const content = JSON.stringify(catalog, null, 2) + '\n';
  if (checkOnly) {
    const existing = await readFile(target, 'utf8').catch(() => null);
    if (existing !== content) {
      console.error('catalog/catalog.json is stale; run node scripts/catalog/normalize-seed.mjs');
      process.exitCode = 1;
    } else {
      console.log(`Catalog is current: ${catalog.categories.length} categories, ${catalog.products.length} products, ${catalog.modifierGroups.length} modifier groups.`);
      console.log(`Business validation remains blocked by ${result.blockers.length} source/review gates.`);
    }
  } else {
    await writeFile(target, content);
    console.log(`Wrote catalog/catalog.json (${catalog.categories.length} categories, ${catalog.products.length} products, ${catalog.modifierGroups.length} modifier groups).`);
    console.log(`Business validation remains blocked by ${result.blockers.length} source/review gates.`);
  }
}
