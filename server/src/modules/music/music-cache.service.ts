import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createWriteStream, existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { PassThrough, Readable } from 'stream';
import { YoutubeAudioService } from './youtube-audio.service';

export interface CachedTrack {
  filePath: string;
  mimeType: string;
  durationSeconds: number | null;
}

export interface LiveStream {
  stream: Readable;
  mimeType: string;
  estimatedBytes: number | null;
}

const CACHE_DIR = join(process.cwd(), 'music-cache');
const CUSTOM_LRU_PATH = join(CACHE_DIR, '.custom-lru.json');

// Catalog songs are curated and few — always kept. Custom pasted links can
// be literally anything, so only the most recently played handful are
// kept on disk to avoid unbounded growth.
const MAX_CUSTOM_CACHED = 5;

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
};

interface CacheMeta {
  mimeType: string;
  durationSeconds: number | null;
  ext: string;
}

@Injectable()
export class MusicCacheService implements OnModuleInit {
  private readonly logger = new Logger(MusicCacheService.name);
  private readonly inflight = new Map<string, Promise<CachedTrack>>();
  // Most-recently-used last. Only videoIds explicitly touched via
  // touchCustom() ever land here — catalog songs never do, so they're
  // never eligible for eviction.
  private customLru: string[] = [];

  constructor(private readonly youtubeAudio: YoutubeAudioService) {}

  async onModuleInit() {
    await mkdir(CACHE_DIR, { recursive: true });
    this.customLru = await this.loadCustomLru();
  }

  isDownloading(videoId: string): boolean {
    const result = this.inflight.has(videoId);
    this.logger.log(`isDownloading(${videoId}) = ${result}`);
    return result;
  }

  async readCached(videoId: string): Promise<CachedTrack | null> {
    return this.readFromDisk(videoId);
  }

  async getOrFetch(videoId: string): Promise<CachedTrack> {
    const cached = await this.readFromDisk(videoId);
    if (cached) {
      this.logger.log(`getOrFetch(${videoId}): disk cache hit`);
      return cached;
    }

    const pending = this.inflight.get(videoId);
    if (pending) {
      this.logger.log(
        `getOrFetch(${videoId}): joining existing in-flight task`,
      );
      return pending;
    }

    this.logger.log(`getOrFetch(${videoId}): starting new download()`);
    const task = this.download(videoId).finally(() =>
      this.inflight.delete(videoId),
    );
    this.inflight.set(videoId, task);
    return task;
  }

  // Starts a fresh download that streams live to the caller (e.g. an HTTP
  // response) while simultaneously being written to the on-disk cache.
  // Registers itself in `inflight` the same way getOrFetch()'s internal
  // download does, so any concurrent request for the same videoId dedupes
  // onto this one via getOrFetch() — they just won't get a live stream of
  // their own, they'll wait for the file and read it from disk once ready.
  async streamLive(videoId: string): Promise<LiveStream> {
    this.logger.log(`Downloading audio for ${videoId}…`);
    const audio = await this.youtubeAudio.fetchAudio(videoId);
    this.logger.log(
      `${videoId}: fetchAudio() resolved (mimeType=${audio.mimeType}, durationSeconds=${audio.durationSeconds ?? '(unknown)'}, estimatedBytes=${audio.estimatedBytes ?? '(unknown)'})`,
    );
    const ext = EXT_BY_MIME[audio.mimeType] ?? 'webm';
    const filePath = join(CACHE_DIR, `${videoId}.${ext}`);

    const fileStream = createWriteStream(filePath);
    const responseStream = new PassThrough();
    audio.stream.pipe(fileStream);
    audio.stream.pipe(responseStream);

    let bytesSeen = 0;
    audio.stream.on('data', (chunk: Buffer) => {
      bytesSeen += chunk.length;
    });

    const task = new Promise<CachedTrack>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.logger.error(
          `${videoId}: streamLive failed after ${bytesSeen} bytes: ${err.message}`,
        );
        fileStream.destroy();
        responseStream.destroy(err);
        void rm(filePath, { force: true });
        reject(err);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        const meta: CacheMeta = {
          mimeType: audio.mimeType,
          durationSeconds: audio.durationSeconds,
          ext,
        };
        writeFile(join(CACHE_DIR, `${videoId}.json`), JSON.stringify(meta))
          .then(() => {
            this.logger.log(
              `Cached audio for ${videoId} → ${filePath} (${bytesSeen} bytes)`,
            );
            resolve({
              filePath,
              mimeType: audio.mimeType,
              durationSeconds: audio.durationSeconds,
            });
          })
          .catch(fail);
      };

      audio.stream.on('error', (err: Error) => {
        this.logger.error(`${videoId}: audio.stream errored: ${err.message}`);
        fail(err);
      });
      fileStream.on('error', (err: Error) => {
        this.logger.error(`${videoId}: fileStream errored: ${err.message}`);
        fail(err);
      });
      // A failed yt-dlp process still ends its stdout "cleanly" as far as
      // the pipe is concerned — fileStream.finish() fires the same way it
      // would for a real success (Node fires stdout's 'end' before the
      // process 'close' event, so there's no way to catch this via stream
      // errors alone). Only trust it once we've also confirmed the
      // process actually exited 0.
      fileStream.on('finish', () => {
        this.logger.log(
          `${videoId}: fileStream finished (${bytesSeen} bytes written), awaiting exit code`,
        );
        void audio.exitCode.then((code) => {
          this.logger.log(`${videoId}: yt-dlp exit code = ${code}`);
          if (code !== 0) {
            fail(new Error(`yt-dlp exited ${code} for ${videoId}`));
            return;
          }
          succeed();
        });
      });
    });
    const trackedTask = task.finally(() => this.inflight.delete(videoId));
    // streamLive() itself never awaits `task` (that's the whole point —
    // it returns the live stream immediately). A rejection with zero
    // listeners is an unhandled promise rejection, which crashes the
    // whole Node process by default. This no-op catch is just to satisfy
    // that — any concurrent getOrFetch() call for the same videoId still
    // gets the real rejection when *it* awaits this same promise.
    trackedTask.catch(() => {});
    this.inflight.set(videoId, trackedTask);

    return {
      stream: responseStream,
      mimeType: audio.mimeType,
      estimatedBytes: audio.estimatedBytes,
    };
  }

  // Marks a custom-link videoId as just-used, evicting the least-recently
  // used custom entries beyond MAX_CUSTOM_CACHED. No-op for catalog songs
  // (they're simply never passed through this).
  async touchCustom(videoId: string): Promise<void> {
    this.customLru = this.customLru.filter((id) => id !== videoId);
    this.customLru.push(videoId);
    this.logger.log(
      `touchCustom(${videoId}): LRU now [${this.customLru.join(', ')}]`,
    );

    while (this.customLru.length > MAX_CUSTOM_CACHED) {
      const evictId = this.customLru.shift();
      if (evictId) await this.evictFromDisk(evictId);
    }

    await this.saveCustomLru();
  }

  private async evictFromDisk(videoId: string): Promise<void> {
    const metaPath = join(CACHE_DIR, `${videoId}.json`);
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as CacheMeta;
      await rm(join(CACHE_DIR, `${videoId}.${meta.ext}`), { force: true });
    } catch {
      // no metadata (e.g. never finished downloading) — nothing to clean up
    }
    await rm(metaPath, { force: true });
    this.logger.log(`Evicted cached custom-link audio for ${videoId}`);
  }

  private async loadCustomLru(): Promise<string[]> {
    if (!existsSync(CUSTOM_LRU_PATH)) return [];
    try {
      const parsed: unknown = JSON.parse(
        await readFile(CUSTOM_LRU_PATH, 'utf8'),
      );
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private saveCustomLru(): Promise<void> {
    return writeFile(CUSTOM_LRU_PATH, JSON.stringify(this.customLru));
  }

  private async readFromDisk(videoId: string): Promise<CachedTrack | null> {
    const metaPath = join(CACHE_DIR, `${videoId}.json`);
    if (!existsSync(metaPath)) {
      this.logger.log(`readFromDisk(${videoId}): no meta file at ${metaPath}`);
      return null;
    }

    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as CacheMeta;
      const filePath = join(CACHE_DIR, `${videoId}.${meta.ext}`);
      if (!existsSync(filePath)) {
        this.logger.log(
          `readFromDisk(${videoId}): meta exists but audio file missing at ${filePath}`,
        );
        return null;
      }
      this.logger.log(`readFromDisk(${videoId}): hit at ${filePath}`);
      return {
        filePath,
        mimeType: meta.mimeType,
        durationSeconds: meta.durationSeconds,
      };
    } catch (e) {
      this.logger.warn(
        `readFromDisk(${videoId}): failed to parse meta at ${metaPath}: ${String(e)}`,
      );
      return null;
    }
  }

  private async download(videoId: string): Promise<CachedTrack> {
    this.logger.log(`Downloading audio for ${videoId}…`);
    const audio = await this.youtubeAudio.fetchAudio(videoId);
    this.logger.log(
      `${videoId}: fetchAudio() resolved (mimeType=${audio.mimeType}, durationSeconds=${audio.durationSeconds ?? '(unknown)'})`,
    );
    const ext = EXT_BY_MIME[audio.mimeType] ?? 'webm';
    const filePath = join(CACHE_DIR, `${videoId}.${ext}`);

    let bytesSeen = 0;
    await new Promise<void>((resolve, reject) => {
      const fileStream = createWriteStream(filePath);
      audio.stream.pipe(fileStream);
      audio.stream.on('data', (chunk: Buffer) => {
        bytesSeen += chunk.length;
      });
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.logger.error(
          `${videoId}: download() failed after ${bytesSeen} bytes: ${err.message}`,
        );
        fileStream.destroy();
        void rm(filePath, { force: true });
        reject(err);
      };
      audio.stream.on('error', fail);
      fileStream.on('error', fail);
      // See streamLive()'s identical comment — fileStream.finish() alone
      // doesn't mean the download actually succeeded.
      fileStream.on('finish', () => {
        this.logger.log(
          `${videoId}: fileStream finished (${bytesSeen} bytes written), awaiting exit code`,
        );
        void audio.exitCode.then((code) => {
          this.logger.log(`${videoId}: yt-dlp exit code = ${code}`);
          if (code !== 0) {
            fail(new Error(`yt-dlp exited ${code} for ${videoId}`));
            return;
          }
          if (settled) return;
          settled = true;
          resolve();
        });
      });
    });

    const meta: CacheMeta = {
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
      ext,
    };
    await writeFile(join(CACHE_DIR, `${videoId}.json`), JSON.stringify(meta));

    this.logger.log(
      `Cached audio for ${videoId} → ${filePath} (${bytesSeen} bytes)`,
    );
    return {
      filePath,
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
    };
  }
}
