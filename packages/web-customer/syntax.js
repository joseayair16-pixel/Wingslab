const fs = require('fs');
const code = fs.readFileSync('packages/web-customer/src/app/page.tsx', 'utf8');
const lines = code.split('\n');
let divCount = 0;
let braceCount = 0;

for(let i=4530; i<4950; i++) {
  const l = lines[i] || '';
  const openBraces = (l.match(/\{/g) || []).length;
  const closeBraces = (l.match(/\}/g) || []).length;
  const openDiv = (l.match(/<div/g) || []).length;
  const closeDiv = (l.match(/<\/div>/g) || []).length;
  divCount += openDiv - closeDiv;
  braceCount += openBraces - closeBraces;
  if(braceCount !== 0 || divCount !== 0) {
    console.log(`${i+1}: D[${divCount}] B[${braceCount}] | ${l.trim()}`);
  }
}
