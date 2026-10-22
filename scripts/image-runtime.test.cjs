const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const test = require('node:test');

// Resolve from the optimizer itself: an application-level version check alone
// could miss a nested copy or the NEXT_SHARP_PATH override used by Next 13.
const optimizerPath = require.resolve('next/dist/server/image-optimizer');
const optimizerRequire = createRequire(optimizerPath);
const sharp = optimizerRequire(process.env.NEXT_SHARP_PATH || 'sharp');
const { optimizeImage } = require(optimizerPath);
const { gte, valid, satisfies } = require('next/dist/compiled/semver');
const { brotliCompressSync, brotliDecompressSync } = require('node:zlib');
const manifest = require('../package.json');

function assertPatchedSharp(version) {
  assert.ok(valid(version) && !version.includes('-') && gte(version, '0.35.5'),
    `The effective Sharp must be a stable version >=0.35.5; found ${version}`);
}

test('the runtime is on a fixed supported Node line', () => {
  assert.ok(satisfies(process.versions.node, manifest.engines.node),
    `Node ${process.versions.node} does not satisfy ${manifest.engines.node}`);
  assert.equal(satisfies('22.23.2', manifest.engines.node), false);
  assert.equal(satisfies('22.23.4', manifest.engines.node), true);
  assert.equal(satisfies('24.22.1', manifest.engines.node), true);
  const input = Buffer.from('ordinary compressed image metadata');
  assert.deepEqual(brotliDecompressSync(brotliCompressSync(input)), input);
  assert.throws(() => brotliDecompressSync(Buffer.from([0xff, 0xff, 0xff])));
});

test('the image security floor rejects the affected release and prereleases', () => {
  assert.throws(() => assertPatchedSharp('0.35.4'));
  assert.throws(() => assertPatchedSharp('0.35.5-rc.1'));
  assert.throws(() => assertPatchedSharp('unknown'));
  assertPatchedSharp('0.35.5');
});

test('the installed framework and both image runtime resolutions match the pins', (t) => {
  assert.equal(require('next/package.json').version, manifest.dependencies.next);
  assert.equal(require('next/package.json').version, '13.5.11');
  assert.equal(require('sharp').versions.sharp, manifest.dependencies.sharp);
  assertPatchedSharp(require('sharp').versions.sharp);
  assertPatchedSharp(sharp.versions.sharp);
  assert.ok(sharp.versions.rsvg, 'the native SVG decoder must load');
  t.diagnostic(JSON.stringify({ next: require('next/package.json').version,
    optimizerSharpPath: optimizerRequire.resolve(process.env.NEXT_SHARP_PATH || 'sharp'),
    nativeVersions: sharp.versions }));
});

for (const format of ['png', 'jpeg']) {
  test(`Next still optimizes a legitimate ${format.toUpperCase()} image`, async () => {
    const input = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: { r: 20, g: 40, b: 60 } } }).toFormat(format).toBuffer();
    const output = await optimizeImage({ buffer: input, contentType: `image/${format}`,
      quality: 80, width: 2 });
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 2);
    assert.equal(metadata.height, 2);
    assert.equal(metadata.format, format);
  });
}

test('the patched native decoder renders a harmless SVG', async () => {
  const input = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="blue"/></svg>');
  const output = await optimizeImage({ buffer: input, contentType: 'image/png',
    quality: 80, width: 2 });
  assert.equal((await sharp(output).metadata()).width, 2);
});

test('the optimizer rejects non-image bytes', async () => {
  await assert.rejects(() => optimizeImage({ buffer: Buffer.from('not an image'),
    contentType: 'image/png', quality: 80, width: 2 }));
});
