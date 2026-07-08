import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Report file storage on the local filesystem (was a Cloudflare R2 bucket).
 * Implements the subset of the R2 API the app uses, so call sites are unchanged.
 * Keys look like `<visit_id>/<timestamp>-<safe_name>` and map to paths under root.
 */
export class Bucket {
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a key to a path, refusing anything that escapes the root. */
  private path(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`Bad storage key: ${key}`);
    return p;
  }

  async put(key: string, body: ReadableStream, _opts?: { httpMetadata?: { contentType?: string } }) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), createWriteStream(p));
  }

  async get(key: string): Promise<{ body: ReadableStream } | null> {
    const p = this.path(key);
    try {
      await stat(p);
    } catch {
      return null;
    }
    return { body: Readable.toWeb(createReadStream(p)) as unknown as ReadableStream };
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
