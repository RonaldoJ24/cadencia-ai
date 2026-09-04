#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) {
  console.error('Falta DEEPSEEK_API_KEY en service/.env.local.');
  process.exit(1);
}

const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error('PORT debe ser un puerto válido.');
  process.exit(1);
}

const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash';
const serviceToken = randomBytes(32).toString('base64url');
const serviceUrl = `http://127.0.0.1:${port}`;
const frontendEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('DEEPSEEK_')),
);

Object.assign(frontendEnv, {
  CADENCIA_ENABLE_LIVE: 'true',
  CADENCIA_INTENT_SERVICE_URL: serviceUrl,
  CADENCIA_SERVICE_TOKEN: serviceToken,
  CADENCIA_LOCAL_NODE: 'true',
});

const serviceEnv = {
  ...process.env,
  DEEPSEEK_API_KEY: apiKey,
  DEEPSEEK_MODEL: model,
  CADENCIA_SERVICE_TOKEN: serviceToken,
  PORT: String(port),
};

if (process.argv.includes('--check')) {
  if (
    'DEEPSEEK_API_KEY' in frontendEnv ||
    frontendEnv.CADENCIA_ENABLE_LIVE !== 'true' ||
    frontendEnv.CADENCIA_LOCAL_NODE !== 'true'
  ) {
    throw new Error('La configuración live local no aisló la llave correctamente.');
  }
  console.log('Configuración live local válida; no se llamó al proveedor.');
  process.exit(0);
}

const children = [
  ['servicio Python', spawn('uv', [
    'run', '--project', 'service', '--frozen',
    'uvicorn', 'app:app', '--app-dir', 'service',
    '--host', '127.0.0.1', '--port', String(port),
    '--no-access-log', '--log-level', 'critical',
  ], { env: serviceEnv, stdio: 'inherit' })],
  ['app', spawn('npm', ['run', 'dev'], { env: frontendEnv, stdio: 'inherit' })],
];

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const [, child] of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => stop(signal));
}

for (const [name, child] of children) {
  child.once('error', (error) => {
    console.error(`No se pudo iniciar ${name}: ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  child.once('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} terminó (${signal || code || 0}).`);
    process.exitCode = code || 1;
    stop();
  });
}
