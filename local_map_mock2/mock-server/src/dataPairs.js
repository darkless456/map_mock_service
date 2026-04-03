'use strict';

const fs = require('fs/promises');
const path = require('path');

/**
 * @param {string} dataDir absolute or cwd-relative
 * @returns {Promise<{ base: string, xmlPath: string, pngPath: string }[]>}
 */
async function loadDataPairs(dataDir) {
  const abs = path.resolve(dataDir);
  const names = await fs.readdir(abs);
  const bases = new Set();
  for (const name of names) {
    if (name.endsWith('.xml')) bases.add(name.slice(0, -4));
    if (name.endsWith('.png')) bases.add(name.slice(0, -4));
  }

  const pairs = [];
  for (const base of bases) {
    const xmlPath = path.join(abs, `${base}.xml`);
    const pngPath = path.join(abs, `${base}.png`);
    try {
      await fs.access(xmlPath);
      await fs.access(pngPath);
    } catch {
      continue;
    }
    pairs.push({ base, xmlPath, pngPath });
  }

  pairs.sort((a, b) => {
    try {
      const na = BigInt(a.base);
      const nb = BigInt(b.base);
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    } catch {
      return a.base.localeCompare(b.base);
    }
  });

  return pairs;
}

module.exports = { loadDataPairs };
