import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { YoutubeAudioService } from './youtube-audio.service';

export interface CachedTrack {
  filePath: string;
  mimeType: string;
  durationSeconds: number | null;
}

const CACHE_DIR = join(process.cwd(), 'music-cache');

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

// Downloaded audio is kept on disk indefinitely, keyed by videoId, so a
// song is only ever extracted from YouTube once. Concurrent first-plays of
// the same song share a single in-flight download instead of racing.
@Injectable()
export class MusicCacheService implements OnModuleInit {
  private readonly logger = new Logger(MusicCacheService.name);
  private readonly inflight = new Map<string, Promise<CachedTrack>>();

  constructor(private readonly youtubeAudio: YoutubeAudioService) {}

  async onModuleInit() {
    await mkdir(CACHE_DIR, { recursive: true });
  }

  async getOrFetch(videoId: string): Promise<CachedTrack> {
    const cached = await this.readFromDisk(videoId);
    if (cached) return cached;

    const pending = this.inflight.get(videoId);
    if (pending) return pending;

    const task = this.download(videoId).finally(() =>
      this.inflight.delete(videoId),
    );
    this.inflight.set(videoId, task);
    return task;
  }

  private async readFromDisk(videoId: string): Promise<CachedTrack | null> {
    const metaPath = join(CACHE_DIR, `${videoId}.json`);
    if (!existsSync(metaPath)) return null;

    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as CacheMeta;
      const filePath = join(CACHE_DIR, `${videoId}.${meta.ext}`);
      if (!existsSync(filePath)) return null;
      return {
        filePath,
        mimeType: meta.mimeType,
        durationSeconds: meta.durationSeconds,
      };
    } catch {
      return null;
    }
  }

  private async download(videoId: string): Promise<CachedTrack> {
    this.logger.log(`Downloading audio for ${videoId}…`);
    const audio = await this.youtubeAudio.fetchAudio(videoId);
    const ext = EXT_BY_MIME[audio.mimeType] ?? 'webm';
    const filePath = join(CACHE_DIR, `${videoId}.${ext}`);

    await pipeline(audio.stream, createWriteStream(filePath));

    const meta: CacheMeta = {
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
      ext,
    };
    await writeFile(join(CACHE_DIR, `${videoId}.json`), JSON.stringify(meta));

    this.logger.log(`Cached audio for ${videoId} → ${filePath}`);
    return {
      filePath,
      mimeType: audio.mimeType,
      durationSeconds: audio.durationSeconds,
    };
  }
}
