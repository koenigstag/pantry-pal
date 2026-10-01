import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { RECIPE_IMPORT_ERROR, type RecipeImportErrorCode } from '@pantry-pal/shared';

/** Why a page was not fetched. `code` is what the client picks its words by. */
export class RecipeImportError extends Error {
  constructor(
    readonly code: RecipeImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** A recipe page is HTML of a few hundred KB; this only turns away what is not one. */
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const WEB_PORTS = new Set(['', '80', '443']);
/** The form crawlers and link previews use: some sites refuse a client that does not start with `Mozilla/5.0`. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; PantryPal-RecipeImport/1.0; +https://github.com/koenigstag/pantry-pal)';

/**
 * Addresses a user-supplied URL must never reach: loopback, private and
 * link-local networks (cloud metadata lives at 169.254.169.254), carrier-grade
 * NAT, multicast and the reserved ranges, in both families. IPv4 written as
 * IPv6 (`::ffff:10.0.0.1`) is checked as the IPv4 it is.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped !== undefined) return BLOCKED.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Resolves like `dns.lookup`, then refuses the host if any of its addresses is
 * blocked. Checked here, at connect time, rather than before the request: a
 * name checked first and resolved again to connect could answer differently
 * the second time (DNS rebinding).
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error !== null) {
      callback(error, '', 0);
      return;
    }
    const allowed =
      addresses.length > 0 && addresses.every((entry) => !isBlockedAddress(entry.address));
    if (!allowed) {
      callback(
        Object.assign(new Error(`${hostname} resolves to an address that is not public`), {
          code: 'EBLOCKED',
        }),
        '',
        0,
      );
      return;
    }
    if (options.all === true) {
      callback(null, addresses);
    } else {
      const [first] = addresses;
      callback(null, first?.address ?? '', first?.family ?? 4);
    }
  });
};

/** The URL as a fetchable web address, or a `blocked-url` error. */
export function checkRecipeUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RecipeImportError(RECIPE_IMPORT_ERROR.BlockedUrl, 'Not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RecipeImportError(
      RECIPE_IMPORT_ERROR.BlockedUrl,
      'Only http and https pages can be imported',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new RecipeImportError(
      RECIPE_IMPORT_ERROR.BlockedUrl,
      'A URL with credentials cannot be imported',
    );
  }
  if (!WEB_PORTS.has(url.port)) {
    throw new RecipeImportError(
      RECIPE_IMPORT_ERROR.BlockedUrl,
      'Only the standard web ports can be fetched',
    );
  }
  // An address written as such never reaches the lookup.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new RecipeImportError(RECIPE_IMPORT_ERROR.BlockedUrl, 'That address is not public');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new RecipeImportError(RECIPE_IMPORT_ERROR.BlockedUrl, 'That address is not public');
  }
  url.hash = '';
  return url;
}

export interface FetchedPage {
  /** Where the page was found, after redirects. */
  url: string;
  html: string;
}

/**
 * Fetches a page for the recipe importer, guarded for a URL a user typed: web
 * ports only, public addresses only (each redirect checked again), a time
 * limit, and a size limit on the decompressed body.
 */
export async function fetchRecipePage(input: string): Promise<FetchedPage> {
  const deadline = Date.now() + TIMEOUT_MS;
  let url = checkRecipeUrl(input);

  for (let redirects = 0; ; redirects += 1) {
    // Each redirect names the next request: they cannot run in parallel.
    // oxlint-disable-next-line no-await-in-loop
    const response = await get(url, deadline);
    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400 && response.headers.location !== undefined) {
      response.resume();
      if (redirects >= MAX_REDIRECTS) {
        throw new RecipeImportError(RECIPE_IMPORT_ERROR.Unreachable, 'Too many redirects');
      }
      url = checkRecipeUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new RecipeImportError(RECIPE_IMPORT_ERROR.Unreachable, `The page answered ${status}`);
    }

    const contentType = response.headers['content-type'] ?? '';
    if (!/html|xml/i.test(contentType) && contentType !== '') {
      response.resume();
      throw new RecipeImportError(RECIPE_IMPORT_ERROR.NotAPage, `Not a web page: ${contentType}`);
    }

    // oxlint-disable-next-line no-await-in-loop
    const body = await readBody(response, deadline);
    return { url: url.href, html: decode(body, contentType) };
  }
}

function get(url: URL, deadline: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        timeout: Math.max(1, deadline - Date.now()),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EBLOCKED'
          ? new RecipeImportError(RECIPE_IMPORT_ERROR.BlockedUrl, error.message)
          : new RecipeImportError(
              RECIPE_IMPORT_ERROR.Unreachable,
              `The page did not load: ${error.message}`,
            ),
      );
    });
    request.end();
  });
}

/** The body, decompressed, up to `MAX_PAGE_BYTES` and the deadline. */
function readBody(response: IncomingMessage, deadline: number): Promise<Buffer> {
  const encoding = String(response.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();
  const stream =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? response.pipe(createGunzip())
      : encoding === 'deflate'
        ? response.pipe(createInflate())
        : encoding === 'br'
          ? response.pipe(createBrotliDecompress())
          : response;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(
      () => fail(new RecipeImportError(RECIPE_IMPORT_ERROR.Unreachable, 'The page took too long')),
      Math.max(1, deadline - Date.now()),
    );

    function fail(error: Error): void {
      clearTimeout(timer);
      response.destroy();
      reject(error);
    }

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAGE_BYTES) {
        fail(new RecipeImportError(RECIPE_IMPORT_ERROR.NotAPage, 'The page is too large'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', (error: Error) =>
      fail(
        new RecipeImportError(
          RECIPE_IMPORT_ERROR.Unreachable,
          `The page did not load: ${error.message}`,
        ),
      ),
    );
  });
}

/**
 * Text in the page's own encoding: the header's charset, else a `<meta>` one
 * near the top, else UTF-8. Older Russian and Ukrainian sites still serve
 * windows-1251.
 */
function decode(body: Buffer, contentType: string): string {
  const head = body.subarray(0, 4096).toString('latin1');
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
