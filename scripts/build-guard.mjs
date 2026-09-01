#!/usr/bin/env node

import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DOTENV_GUARD_VERSION = '1';
export const ROOT_DOTENV_NAMES = Object.freeze([
  '.env',
  '.env.local',
  '.env.test',
  '.env.test.local',
]);
const SELF_TEST_DOTENV_NAMES = Object.freeze([
  ...ROOT_DOTENV_NAMES,
  '.env.production',
  '.env.production.local',
  '.env.staging.local',
]);
const SELF_TEST_UNGUARDED_NAMES = Object.freeze([
  '.environment',
  '.envoy',
  '.envrc',
]);

const root = path.resolve(process.cwd());

function resolvedPath(value) {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') return null;
    value = fileURLToPath(value);
  }
  return typeof value === 'string' ? path.resolve(value) : null;
}

export function isGuardedDotenvPath(value) {
  const candidate = resolvedPath(value);
  const basename = candidate === null ? null : path.basename(candidate);
  return candidate !== null
    && path.dirname(candidate) === root
    && (basename === '.env' || basename.startsWith('.env.'));
}

function blocked() {
  const error = new Error('Root dotenv access blocked by the build guard.');
  error.code = 'CADENCIA_DOTENV_BLOCKED';
  return error;
}

function absent() {
  const error = new Error('Root dotenv path is absent.');
  error.code = 'ENOENT';
  return error;
}

function installGuard() {
  const existsSync = fs.existsSync.bind(fs);
  fs.existsSync = (value) => isGuardedDotenvPath(value) ? false : existsSync(value);
  for (const method of ['readFileSync', 'openSync']) {
    const original = fs[method].bind(fs);
    fs[method] = (value, ...args) => {
      if (isGuardedDotenvPath(value)) throw blocked();
      return original(value, ...args);
    };
  }
  for (const method of ['statSync', 'lstatSync', 'accessSync']) {
    const original = fs[method].bind(fs);
    fs[method] = (value, ...args) => {
      if (isGuardedDotenvPath(value)) throw absent();
      return original(value, ...args);
    };
  }
  const createReadStream = fs.createReadStream.bind(fs);
  fs.createReadStream = (value, ...args) => {
    if (isGuardedDotenvPath(value)) throw blocked();
    return createReadStream(value, ...args);
  };
  for (const method of ['readFile', 'open', 'stat', 'lstat', 'access']) {
    const original = fs[method].bind(fs);
    fs[method] = (value, ...args) => {
      if (!isGuardedDotenvPath(value)) return original(value, ...args);
      const callback = args.at(-1);
      if (typeof callback !== 'function') throw blocked();
      queueMicrotask(() => callback(
        method === 'readFile' || method === 'open' ? blocked() : absent(),
      ));
    };
  }
  for (const method of ['readFile', 'open', 'stat', 'lstat', 'access']) {
    const original = fs.promises[method].bind(fs.promises);
    fs.promises[method] = (value, ...args) =>
      isGuardedDotenvPath(value)
        ? Promise.reject(method === 'readFile' || method === 'open' ? blocked() : absent())
        : original(value, ...args);
  }
  syncBuiltinESMExports();
}

function expectCode(label, action, code) {
  try {
    action();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`${label} returned ${error?.code ?? 'an unexpected error'}`);
  }
  throw new Error(`${label} did not fail with ${code}`);
}

async function expectCallbackCode(label, action, code) {
  const error = await new Promise((resolve) => {
    action((callbackError) => resolve(callbackError));
  });
  if (error?.code !== code) {
    throw new Error(`${label} returned ${error?.code ?? 'an unexpected error'}`);
  }
}

async function expectPromiseCode(label, action, code) {
  try {
    await action();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`${label} returned ${error?.code ?? 'an unexpected error'}`);
  }
  throw new Error(`${label} did not reject with ${code}`);
}

async function selfTest() {
  installGuard();
  for (const name of SELF_TEST_UNGUARDED_NAMES) {
    if (isGuardedDotenvPath(path.join(root, name))) {
      throw new Error(`Build guard unexpectedly covers ${name}.`);
    }
  }
  if (isGuardedDotenvPath(path.join(root, 'nested', '.env.production'))) {
    throw new Error('Build guard unexpectedly covers nested/.env.production.');
  }
  for (const name of SELF_TEST_DOTENV_NAMES) {
    const target = path.join(root, name);
    if (fs.existsSync(target)) {
      throw new Error(`Build guard returned an existing path for ${name}`);
    }
    for (const method of ['statSync', 'lstatSync', 'accessSync']) {
      expectCode(`${method} ${name}`, () => fs[method](target), 'ENOENT');
    }
    for (const method of ['stat', 'lstat', 'access']) {
      await expectCallbackCode(`${method} ${name}`, (callback) => fs[method](target, callback), 'ENOENT');
    }
    for (const method of ['stat', 'lstat', 'access']) {
      await expectPromiseCode(`${method} promise ${name}`, () => fs.promises[method](target), 'ENOENT');
    }
    for (const method of ['readFileSync', 'openSync']) {
      expectCode(`${method} ${name}`, () => fs[method](target), 'CADENCIA_DOTENV_BLOCKED');
    }
    for (const method of ['readFile', 'open']) {
      await expectCallbackCode(`${method} ${name}`, (callback) => fs[method](target, callback), 'CADENCIA_DOTENV_BLOCKED');
    }
    for (const method of ['readFile', 'open']) {
      await expectPromiseCode(`${method} promise ${name}`, () => fs.promises[method](target), 'CADENCIA_DOTENV_BLOCKED');
    }
    expectCode(`createReadStream ${name}`, () => fs.createReadStream(target), 'CADENCIA_DOTENV_BLOCKED');
  }
  process.stdout.write(
    `dotenv guard v${DOTENV_GUARD_VERSION}: ${SELF_TEST_DOTENV_NAMES.join(', ')} guarded\n`,
  );
}

if (process.argv[2] === '--self-test') {
  await selfTest();
} else {
  installGuard();
  const cli = path.join(path.dirname(fileURLToPath(import.meta.resolve('vinext'))), 'cli.js');
  await import(pathToFileURL(cli).href);
}
