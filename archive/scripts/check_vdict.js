const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wordlistPath = path.join(__dirname, '..', 'lang', 'vi_wordlist.js');
const badWordsPath = path.join(__dirname, '..', 'bad_words.txt');
const progressPath = path.join(__dirname, 'check_vdict_progress.json');
const missingPhrase = 'Không tìm thấy từ';

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
];

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    sampleWords: [],
    startIndex: 0,
    resume: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--sample' || arg === '--only') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value after --sample/--only');
      }
      options.sampleWords = next.split(',').map((word) => word.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--start') {
      options.startIndex = Number(args[i + 1]) || 0;
      i += 1;
    } else if (arg === '--no-resume') {
      options.resume = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.sampleWords.length > 0) {
    options.resume = false;
  }

  return options;
}

async function loadWordmap() {
  const code = await fs.promises.readFile(wordlistPath, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: wordlistPath });

  if (!sandbox.g_wordmap || typeof sandbox.g_wordmap !== 'object') {
    throw new Error('Could not load g_wordmap from vi_wordlist.js');
  }

  return Object.keys(sandbox.g_wordmap);
}

async function loadExistingBadWords() {
  try {
    const text = await fs.promises.readFile(badWordsPath, 'utf8');
    return new Set(text.split(/\r?\n/).filter(Boolean));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Set();
    }
    throw error;
  }
}

async function loadProgress() {
  try {
    const text = await fs.promises.readFile(progressPath, 'utf8');
    const parsed = JSON.parse(text);
    return {
      index: Number(parsed.index) || 0,
      badCount: Number(parsed.badCount) || 0,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { index: 0, badCount: 0 };
    }
    return { index: 0, badCount: 0 };
  }
}

async function saveProgress(index, badCount) {
  const payload = { index, badCount, updatedAt: new Date().toISOString() };
  await fs.promises.writeFile(progressPath, JSON.stringify(payload, null, 2), 'utf8');
}

async function appendBadWord(word) {
  await fs.promises.appendFile(badWordsPath, `${word}\n`, 'utf8');
}

async function fetchWord(url) {
  const headers = {
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    Referer: 'https://vdict.com/',
    Connection: 'keep-alive',
  };

  const res = await fetch(url, { headers });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

async function main() {
  const options = parseArgs();
  const allWords = await loadWordmap();

  let words = allWords;
  if (options.sampleWords.length > 0) {
    words = options.sampleWords;
  } else {
    shuffle(words);
  }

  const existingBadWords = await loadExistingBadWords();
  const progress = options.resume ? await loadProgress() : { index: 0, badCount: existingBadWords.size };
  let badCount = existingBadWords.size;
  let currentIndex = Math.max(options.startIndex, progress.index);

  if (currentIndex >= words.length) {
    console.log('No words remaining to process.');
    return;
  }

  console.log(`Loaded ${words.length} words. Starting at index ${currentIndex}.`);
  console.log(`Existing bad words already recorded: ${existingBadWords.size}`);

  for (; currentIndex < words.length; currentIndex += 1) {
    const word = words[currentIndex];
    if (existingBadWords.has(word)) {
      const processed = currentIndex + 1;
      const remaining = words.length - processed;
      console.log(`Status: SKIPPED | Processed: ${processed}/${words.length} | Remaining: ${remaining} | Bad: ${badCount} | Word: ${word}`);
      if (processed % 10 === 0 || currentIndex === words.length - 1) {
        await saveProgress(processed, badCount);
      }
      continue;
    }

    const encoded = encodeURIComponent(word);
    const url = `https://vdict.com/${encoded},2,0,0.html`;

    let response;
    try {
      response = await fetchWord(url);
    } catch (error) {
      console.error(`Error fetching ${word}:`, error.message || error);
      const backoffMs = 15000 + Math.random() * 15000;
      console.log(`Waiting ${Math.round(backoffMs / 1000)}s before retrying...`);
      await delay(backoffMs);
      currentIndex -= 1;
      continue;
    }

    const processed = currentIndex + 1;
    const remaining = words.length - processed;
    const foundMissing = response.text.includes(missingPhrase);

    if (!response.ok) {
      console.warn(`Non-OK response for ${word}: ${response.status}. Retrying after a short pause.`);
      await delay(5000 + Math.random() * 5000);
      currentIndex -= 1;
      continue;
    }

    if (foundMissing) {
      if (!existingBadWords.has(word)) {
        await appendBadWord(word);
        existingBadWords.add(word);
        badCount += 1;
      }
    }

    const statusLine = `Processed: ${processed}/${words.length} | Remaining: ${remaining} | Bad: ${badCount} | Word: ${word}`;
    console.log(statusLine);

    if (processed % 10 === 0 || currentIndex === words.length - 1) {
      await saveProgress(processed, badCount);
    }

    if (processed < words.length) {
      const isLongBreak = processed % 60 === 0;
      const waitMs = isLongBreak
        ? 300000 + Math.random() * 900000
        : 1500 + Math.random() * 4500;
      await delay(waitMs);
    }
  }

  await saveProgress(words.length, badCount);
  console.log(`Done. Total bad words recorded: ${badCount}.`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
