const fs = require('fs');
let code = fs.readFileSync('build.bat', 'utf8');

// Update build script to include src/multiplayer.js in minification
code = code.replace(/%temp%\\vietboard\\src\\redipsdrag\.js/, '%temp%\\vietboard\\src\\multiplayer.js %temp%\\vietboard\\src\\redipsdrag.js');
// And remove it from index.html in the target
code = code.replace(/fart\.exe --c-style --remove %target%\\index\.html "<script src=\\"lang\/vi_defs\.js\\"><\/script>\\n"/, 'fart.exe --c-style --remove %target%\\index.html "<script src=\\"src/multiplayer.js\\"></script>\\n"\nfart.exe --c-style --remove %target%\\index.html "<script src=\\"lang/vi_defs.js\\"></script>\\n"');

fs.writeFileSync('build.bat', code);
