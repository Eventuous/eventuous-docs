import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dist = new URL('../dist/', import.meta.url);

function attributes(markup) {
  return Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function versionOptions(html) {
  const selector = html.match(/<starlight-topic-version-select\b[^>]*>([\s\S]*?)<\/starlight-topic-version-select>/)?.[1];
  return selector ? [...selector.matchAll(/<option\b([^>]*)>/g)].map((match) => attributes(match[1])) : [];
}

function readPage(route) {
  return readFileSync(new URL(`.${route}index.html`, dist), 'utf8');
}

for (const [route, target, expected] of [
  ['/dotnet/infra/azure-blob-storage/', 'dotnet-0.16', '/dotnet-0.16/intro/'],
  ['/dotnet/infra/signalr/', 'dotnet-0.16', '/dotnet-0.16/intro/'],
  ['/dotnet-next/infra/azure-blob-storage/', 'dotnet-0.16', '/dotnet-0.16/intro/'],
  ['/dotnet/persistence/event-store/', 'dotnet-0.16', '/dotnet-0.16/persistence/event-store/'],
  ['/dotnet/infra/azure-blob-storage/', 'dotnet-next', '/dotnet-next/infra/azure-blob-storage/'],
  ['/dotnet-0.15/diagnostics/traces/', 'dotnet', '/dotnet/intro/'],
]) {
  test(`switching ${route} to ${target} opens ${expected}`, () => {
    const option = versionOptions(readPage(route)).find((item) => item.value === target);
    assert.ok(option, `Version ${target} must be offered on ${route}`);
    assert.equal(option['data-href'], expected);
  });
}

for (const version of ['dotnet', 'dotnet-next']) {
  test(`the ${version} SignalR Gateway link stays in its selected version`, () => {
    const route = `/${version}/infra/signalr/`;
    const gateway = readPage(route).match(/<a\b([^>]*)>Gateway<\/a>/);
    assert.ok(gateway, 'SignalR introduction must link to the Gateway docs');
    const destination = new URL(attributes(gateway[1]).href, `https://eventuous.dev${route}`);
    assert.equal(destination.pathname.replace(/\/$/, ''), `/${version}/gateway`);
  });
}

test('every rendered version choice points to an existing page in that version', () => {
  let destinations = 0;
  for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const path = join(entry.parentPath, entry.name);
    for (const option of versionOptions(readFileSync(path, 'utf8'))) {
      const href = option['data-href'];
      assert.ok(href?.startsWith(`/${option.value}/`), `${path}: invalid destination for ${option.value}`);
      assert.ok(existsSync(new URL(`.${href}index.html`, dist)), `${path}: missing destination ${href}`);
      destinations++;
    }
  }
  assert.ok(destinations > 0, 'The build must contain version navigation');
});
