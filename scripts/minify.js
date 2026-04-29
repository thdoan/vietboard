#!/usr/bin/env node
/**
 * Cross-platform minification script for Vietboard.
 * Replaces Microsoft AjaxMin for JS and CSS bundling.
 *
 * Usage:
 *   node scripts/minify.js css <file>... -o <outfile>
 *   node scripts/minify.js js  <file>... -o <outfile>
 */

const fs = require('fs');
const path = require('path');

const mode = process.argv[2];
const outIndex = process.argv.indexOf('-o');
if (!mode || outIndex === -1 || outIndex === process.argv.length - 1) {
  console.error('Usage: node minify.js <css|js> <files...> -o <outfile>');
  process.exit(1);
}

const files = process.argv.slice(3, outIndex);
const outfile = process.argv[outIndex + 1];

async function main() {
  if (mode === 'css') {
    const CleanCSS = require('clean-css');
    let combined = '';
    for (const f of files) {
      combined += fs.readFileSync(f, 'utf8') + '\n';
    }
    const result = new CleanCSS().minify(combined);
    if (result.errors && result.errors.length) {
      console.error('CSS minification errors:', result.errors);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, result.styles);
    console.log('  CSS  →', outfile, `(${Math.round(result.styles.length / combined.length * 100)}%)`);
  } else if (mode === 'js') {
    const Terser = require('terser');
    const code = {};
    for (const f of files) {
      code[f] = fs.readFileSync(f, 'utf8');
    }
    const result = await Terser.minify(code, {
      compress: {
        drop_console: true,
        dead_code: true,
        global_defs: { DEBUG: false }
      },
      mangle: false,
      format: { comments: /^!/ }
    });
    if (result.error) {
      console.error('JS minification error:', result.error);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    fs.writeFileSync(outfile, result.code);
    const origSize = Object.values(code).reduce((a, b) => a + b.length, 0);
    console.log('  JS   →', outfile, `(${Math.round(result.code.length / origSize * 100)}%)`);
  } else {
    console.error('Unknown mode:', mode);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
