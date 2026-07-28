const fs = require('fs');
let content = fs.readFileSync('public/dive.html', 'utf8');

// 1. Change name and avatar initials
content = content.replace(
  /<span style="font-family:var\(--disp\); font-size:16px; color:#e4dfda;">OM<\/span>/,
  '<span style="font-family:var(--disp); font-size:16px; color:#e4dfda;">ZF</span>'
);
content = content.replace(
  /<span style="font-family:var\(--body\); font-size:17px; font-weight:700; color:#e4dfda; letter-spacing:-0.02em;">Omer Aydogan<\/span>/,
  '<span style="font-family:var(--body); font-size:17px; font-weight:700; color:#e4dfda; letter-spacing:-0.02em;">Zen Falcon</span>'
);

// 2. Remove the h1
content = content.replace(/<h1 id="hero-word">DEGENSLIDE<\/h1>/, '');

// 3. Prevent GSAP from crashing because of missing #hero-word
content = content.replace(
  /const heroWord = document\.getElementById\('hero-word'\);\nheroWord\.innerHTML = heroWord\.textContent\.split\(''\)\.map\(c => `<span class="ch">\$\{c\}<\/span>`\)\.join\(''\);\nif \(!REDUCED && JUMP === null\)\{\n  gsap\.from\('#hero-word \.ch', \{[^\}]+\}\);\n\}/,
  '/* removed hero-word animation */'
);

// Since the previous append might have been inserted inside the block or right after, let's just make sure we don't break the #hero-deck-wrap animation.
// The previous append was right after `gsap.from('#hero-word .ch', {...});`
// Actually, in the previous script:
// content = content.replace(/(gsap\.from\('#hero-word \.ch', \{[^\}]+\}\);)/, `$1${scriptAppend}`);
// Let's replace the whole block more safely, just by using a regular expression for the heroWord setup:
content = content.replace(
  /const heroWord = document\.getElementById\('hero-word'\);[\s\S]*?gsap\.from\('#hero-word \.ch', \{[\s\S]*?\}\);/,
  '/* hero word removed */'
);

// Wait, let's just replace the JS block safely.
fs.writeFileSync('public/dive.html', content);
