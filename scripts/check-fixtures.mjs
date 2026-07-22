import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixturesRoot = path.join(root, 'fixtures');

function readFixture(relativePath) {
  const abs = path.join(fixturesRoot, relativePath);
  const text = fs.readFileSync(abs, 'utf8');
  return JSON.parse(relativePath.endsWith('.jsonc') ? stripJsonComments(text) : text);
}

function assertObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain an object`);
  }
}

function assertNumber(value, label) {
  if (typeof value !== 'number') throw new Error(`${label} must be a number`);
}

function assertString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
}

function assertMetadata(value, label) {
  assertObject(value, label);
  assertNumber(value.resolution, `${label}.resolution`);
  assertNumber(value.origin_x, `${label}.origin_x`);
  assertNumber(value.origin_y, `${label}.origin_y`);
}

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}

{
  const relativePath = 'maps/map_list.json';
  const mapList = readFixture(relativePath);
  assertObject(mapList, `fixtures/${relativePath}`);
  assertObject(mapList.data, `fixtures/${relativePath}.data`);
  if (!Array.isArray(mapList.data.items)) {
    throw new Error(`fixtures/${relativePath}.data.items must be an array`);
  }
}

const metadata = readFixture('maps/metadata.jsonc');
assertObject(metadata, 'fixtures/maps/metadata.jsonc');
assertMetadata(metadata.default, 'fixtures/maps/metadata.jsonc.default');
assertObject(metadata.maps, 'fixtures/maps/metadata.jsonc.maps');
for (const [mapId, value] of Object.entries(metadata.maps)) {
  assertMetadata(value, `fixtures/maps/metadata.jsonc.maps.${mapId}`);
}

assertObject(readFixture('device/self_check.jsonc'), 'fixtures/device/self_check.jsonc');

const mappingCheck = readFixture('mapping/check_conditions.jsonc');
assertObject(mappingCheck, 'fixtures/mapping/check_conditions.jsonc');
for (const key of ['bluetooth_status', 'bluetooth_msg', 'cellular', 'wifi', 'battery', 'docking_station', 'light']) {
  assertString(mappingCheck[key], `fixtures/mapping/check_conditions.jsonc.${key}`);
}

const fallback = readFixture('mowing/trajectory_fallback.jsonc');
if (!Array.isArray(fallback) || fallback.length < 2) {
  throw new Error('fixtures/mowing/trajectory_fallback.jsonc must contain at least two points');
}
for (const [index, point] of fallback.entries()) {
  assertObject(point, `fixtures/mowing/trajectory_fallback.jsonc[${index}]`);
  assertNumber(point.x, `fixtures/mowing/trajectory_fallback.jsonc[${index}].x`);
  assertNumber(point.y, `fixtures/mowing/trajectory_fallback.jsonc[${index}].y`);
}

const recharge = readFixture('recharge/notify_sequence.jsonc');
assertObject(recharge, 'fixtures/recharge/notify_sequence.jsonc');
assertNumber(recharge.idleDelayMs, 'fixtures/recharge/notify_sequence.jsonc.idleDelayMs');
if (!Array.isArray(recharge.steps)) {
  throw new Error('fixtures/recharge/notify_sequence.jsonc.steps must be an array');
}
for (const [index, step] of recharge.steps.entries()) {
  assertObject(step, `fixtures/recharge/notify_sequence.jsonc.steps[${index}]`);
  assertNumber(step.atMs, `fixtures/recharge/notify_sequence.jsonc.steps[${index}].atMs`);
  assertString(step.subStatus, `fixtures/recharge/notify_sequence.jsonc.steps[${index}].subStatus`);
}

const realism = readFixture('sim/realism.jsonc');
assertObject(realism, 'fixtures/sim/realism.jsonc');
for (const key of ['httpDelayMinMs', 'httpDelayMaxMs', 'wsDelayMinMs', 'wsDelayMaxMs']) {
  assertNumber(realism[key], `fixtures/sim/realism.jsonc.${key}`);
}
if (typeof realism.enabled !== 'boolean') throw new Error('fixtures/sim/realism.jsonc.enabled must be a boolean');

const datasetsRoot = path.join(fixturesRoot, 'datasets');
for (const datasetName of fs.readdirSync(datasetsRoot).sort()) {
  const datasetDir = path.join(datasetsRoot, datasetName);
  if (!fs.statSync(datasetDir).isDirectory()) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(datasetDir, 'manifest.json'), 'utf8'));
  assertObject(manifest, `fixtures/datasets/${datasetName}/manifest.json`);
  assertString(manifest.name, `fixtures/datasets/${datasetName}/manifest.json.name`);
  assertNumber(manifest.frameCount, `fixtures/datasets/${datasetName}/manifest.json.frameCount`);
  const framesDir = path.join(datasetDir, 'frames');
  const xml = fs.readdirSync(framesDir).filter(file => file.endsWith('.xml'));
  const png = new Set(fs.readdirSync(framesDir).filter(file => file.endsWith('.png')));
  let pairCount = 0;
  for (const xmlFile of xml) {
    const pngFile = `${path.basename(xmlFile, '.xml')}.png`;
    if (!png.has(pngFile)) throw new Error(`missing png pair for ${path.join(framesDir, xmlFile)}`);
    pairCount += 1;
  }
  if (pairCount !== manifest.frameCount) {
    throw new Error(`fixtures/datasets/${datasetName} manifest frameCount ${manifest.frameCount} does not match ${pairCount}`);
  }
}

const faultsRoot = path.join(fixturesRoot, 'faults');
if (fs.existsSync(faultsRoot)) {
  for (const file of fs.readdirSync(faultsRoot).filter(name => name.endsWith('.json')).sort()) {
    const label = `fixtures/faults/${file}`;
    const fault = readFixture(`faults/${file}`);
    assertObject(fault, label);
    assertString(fault.name, `${label}.name`);
    if (fault.description !== undefined) assertString(fault.description, `${label}.description`);
    if (fault.dataset !== undefined) assertString(fault.dataset, `${label}.dataset`);
    if (fault.chaos !== undefined) assertObject(fault.chaos, `${label}.chaos`);
    if (fault.setup !== undefined) assertObject(fault.setup, `${label}.setup`);
    if (fault.notify !== undefined) assertObject(fault.notify, `${label}.notify`);
    if (fault.fixtures !== undefined) assertObject(fault.fixtures, `${label}.fixtures`);
  }
}

console.log('fixtures ok');
