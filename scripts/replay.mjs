// Replays the pictures listed in replay-pictures.json through the app's reader
// in a headless browser and prints what was read, what was detected and how long it took.
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const PICTURES = new URL('../../ressources/', import.meta.url).pathname;
const pictures = JSON.parse(await readFile(new URL('./replay-pictures.json', import.meta.url), 'utf8'));

// Uses whichever Chromium Playwright has already downloaded on this machine.
async function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const versions = (await readdir(cache)).filter((name) => /^chromium-\d+$/.test(name)).sort();
  if (versions.length === 0) throw new Error(`No Chromium in ${cache}. Set CHROMIUM to a browser executable.`);
  const folder = join(cache, versions.at(-1));
  const inner = (await readdir(folder)).find((name) => name.startsWith('chrome-linux'));
  return join(folder, inner, 'chrome');
}

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
// A kept profile, so the card database is downloaded once and not on every run.
const context = await chromium.launchPersistentContext('node_modules/.cache/replay-profile', {
  executablePath: await findChromium(),
  headless: true,
});

let failures = 0;
const times = [];
const total = []; // per picture: the time until the card was detected
try {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('page error:', error.message));
  await page.route('**/pictures/*', async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    await route.fulfill({ body: await readFile(join(PICTURES, name)), contentType: 'image/jpeg' });
  });
  await page.goto('http://localhost:5199/replay.html');
  await page.waitForFunction(() => typeof window.replay === 'function');

  for (const picture of pictures) {
    const result = await page.evaluate(([url, card, language]) => window.replay(url, card, language), [`/pictures/${picture.file}`, picture.card, picture.language]);
    const got = result.detected?.kind === 'code' ? result.detected.code : result.detected?.kind === 'card' ? result.detected.name : null;
    const ok =
      picture.code === null ||
      got === picture.code ||
      (result.detected?.kind === 'card' && picture.name !== null && got === picture.name);
    if (!ok) failures++;
    console.log(`\n${picture.file}  expected ${picture.code ?? '?'} / ${picture.name ?? '?'}`);
    console.log(`  detected: ${result.detected?.kind ?? 'nothing'} ${got ?? ''}  ${ok ? 'OK' : 'MISSED'}`);
    console.log(`  name match: ${result.named ? `${result.named.name} [${result.named.language}] ${result.named.score.toFixed(2)}` : 'none'}`);
    total.push(result.readings.reduce((sum, reading) => sum + reading.milliseconds, 0));
    for (const reading of result.readings) {
      times.push(reading.milliseconds);
      console.log(`  ${reading.milliseconds} ms  ${JSON.stringify(reading)}`);
    }
  }
} finally {
  await context.close();
  await server.close();
}

const average = Math.round(times.reduce((sum, time) => sum + time, 0) / times.length);
const untilDetected = Math.round(total.reduce((sum, time) => sum + time, 0) / total.length);
console.log(`\n${pictures.length - failures}/${pictures.length} detected, average ${average} ms per look, ${untilDetected} ms from first look to detection`);
