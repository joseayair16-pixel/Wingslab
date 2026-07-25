const fs = require('fs');
const file = '/Users/ayair/Desktop/SaDeL/packages/web-restaurant/src/app/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Types
content = content.replace(/\s*themeColor\?:\s*string\s*\|\s*null;/g, '');
content = content.replace(/\s*themeColor:\s*string;/g, '');

// Initial state and resets
content = content.replace(/\s*themeColor:\s*'',/g, '');
content = content.replace(/\s*themeColor:\s*profileData\.data\.themeColor\s*\|\|\s*'',/g, '');
content = content.replace(/\s*themeColor:\s*payload\.data\.themeColor\s*\|\|\s*'',/g, '');
content = content.replace(/\s*themeColor:\s*storeDraft\.themeColor\.trim\(\)\s*\|\|\s*null,/g, '');

// The color picker section (around line 7310)
const colorPickerRegex = /<div className="sm:col-span-2">[\s\S]*?<label className="text-sm font-medium text-neutral-900 block mb-2">[\s\S]*?Color de Marca \(Menú\)[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
content = content.replace(colorPickerRegex, '');

fs.writeFileSync(file, content);
console.log('Removed themeColor from web-restaurant');
