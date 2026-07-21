import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'fixtures', 'maps', 'profiles', 'merge');
const width = 160;
const height = 160;

await fs.mkdir(outputDir, { recursive: true });

const semantic = Buffer.alloc(width * height, 255);
const rgb = Buffer.alloc(width * height * 3);

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x;
    const rgbPixel = pixel * 3;
    const insideLawn = x >= 40 && x < 120 && y >= 40 && y < 120;

    if (insideLawn) semantic[pixel] = 0;

    const color = !insideLawn
      ? [224, 228, 226]
      : x < 80
        ? [67, 133, 79]
        : [91, 153, 75];
    rgb[rgbPixel] = color[0];
    rgb[rgbPixel + 1] = color[1];
    rgb[rgbPixel + 2] = color[2];
  }
}

await Promise.all([
  sharp(semantic, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, 'full_semanticmap.png')),
  sharp(rgb, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, 'full_rgbmap.png')),
]);

console.log(`generated adjacent double-lawn assets in ${outputDir}`);
