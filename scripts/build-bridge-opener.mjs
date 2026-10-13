// fix-654 (P-149) — builds the two double-click files the Bridge serves from
// `opener/` sources:
//
//   public/bridge-opener/Install-BridgeOpener.cmd    (embeds bridge-open.ps1)
//   public/bridge-opener/Uninstall-BridgeOpener.cmd
//   public/bridge-opener/bridge-open.ps1             (the handler, for IT)
//
// Run `node scripts/build-bridge-opener.mjs` after editing anything in
// opener/. A test fails when the committed files drift from the sources.
//
// ★ Each .cmd is a batch header that hands the rest of ITSELF to Windows
//   PowerShell 5.1, so one file carries everything and nothing is downloaded
//   at install time. ASCII + CRLF: cmd.exe wants CRLF, and PowerShell 5.1
//   misreads UTF-8 without a BOM (fix-647).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MARKER = '#== POWERSHELL BELOW ==';

function read(name) {
  return readFileSync(join(ROOT, 'opener', name), 'utf8').replace(/\r\n/g, '\n');
}

export function batchHeader(title) {
  return [
    '@echo off',
    `title ${title}`,
    'setlocal',
    'set "BO_SELF=%~f0"',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:BO_SELF); $i=$s.IndexOf('#'+'== POWERSHELL BELOW =='); if ($i -lt 0) { exit 9 }; Invoke-Expression $s.Substring($i)"`,
    'echo.',
    'pause',
    'exit /b',
    MARKER,
    '',
  ].join('\n');
}

export function buildFiles() {
  const handler = read('bridge-open.ps1');
  // ★ A FUNCTION replacement: the handler contains `$'`, which a string
  //   replacement would expand to "the text after the match".
  const install = read('install.ps1').replace('__HANDLER__', () => handler.trimEnd());
  const uninstall = read('uninstall.ps1');
  return {
    'Install-BridgeOpener.cmd': batchHeader('Install Bridge opener') + install,
    'Uninstall-BridgeOpener.cmd': batchHeader('Remove Bridge opener') + uninstall,
    'bridge-open.ps1': handler,
  };
}

export function toCrlf(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(ROOT, 'public', 'bridge-opener');
  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(buildFiles())) {
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) {
      throw new Error(`${name} is not plain ASCII`);
    }
    writeFileSync(join(out, name), toCrlf(text), 'ascii');
    console.log(`wrote public/bridge-opener/${name}`);
  }
}
