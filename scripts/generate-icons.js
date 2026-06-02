const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

async function generateIcons() {
  for (const size of sizes) {
    const radius = Math.round(size * 0.18);
    const fontSize = Math.round(size * 0.5);
    const textY = Math.round(size * 0.68);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#1E40AF"/>
      <text x="${size/2}" y="${textY}" text-anchor="middle" fill="white"
        font-size="${fontSize}" font-weight="bold" font-family="Arial, sans-serif">G</text>
    </svg>`;
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(
      path.join(iconsDir, `icon-${size}.png`)
    );
    console.log(`OK icon-${size}.png`);
  }
  console.log('Toutes les icones generees dans public/icons/');
}
generateIcons().catch(console.error);