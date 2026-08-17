import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Logger,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, statSync } from 'fs';
import { CachedTrack, MusicCacheService } from './music-cache.service';
import { MusicCatalogService } from './music-catalog.service';

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

@Controller('music')
export class MusicController {
  private readonly logger = new Logger(MusicController.name);

  constructor(
    private readonly musicCache: MusicCacheService,
    private readonly musicCatalog: MusicCatalogService,
  ) {}

  @Get('search')
  async search(@Query('q') query?: string) {
    if (!query?.trim()) return { results: [] };
    return { results: await this.musicCatalog.search(query.trim()) };
  }

  @Get('audio/:videoId')
  async streamAudio(
    @Param('videoId') videoId: string,
    @Query('custom') customParam: string | undefined,
    @Headers('range') range: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    this.logger.log(
      `GET audio/${videoId} custom=${customParam ?? '(none)'} range=${range ?? '(none)'}`,
    );

    if (!VIDEO_ID_RE.test(videoId)) {
      this.logger.warn(`rejected "${videoId}": fails VIDEO_ID_RE`);
      throw new BadRequestException('Invalid video id');
    }

    // Catalog songs are curated and few, so they're always kept. Custom
    // pasted links can be anything, so we track recency here and let the
    // cache service evict the oldest ones beyond its cap.
    if (customParam === '1') {
      this.logger.log(`${videoId}: touching custom-link LRU`);
      await this.musicCache.touchCustom(videoId);
    }

    const cached = await this.musicCache.readCached(videoId);
    if (cached) {
      this.logger.log(
        `${videoId}: serving from disk cache (${cached.filePath})`,
      );
      this.serveCached(cached, range, ifNoneMatch, res);
      return;
    }
    this.logger.log(`${videoId}: no disk cache`);

    if (this.musicCache.isDownloading(videoId)) {
      // Someone else already triggered this download — wait for it and
      // serve the finished file. No live progress for this caller, but
      // that's a rare race (two people picking a brand-new song within
      // the same few seconds) and it'll still play once ready.
      this.logger.log(`${videoId}: already in flight, waiting on it`);
      const track = await this.musicCache.getOrFetch(videoId);
      this.logger.log(`${videoId}: in-flight download finished, serving`);
      this.serveCached(track, undefined, ifNoneMatch, res);
      return;
    }

    // First request for this video — stream live while it's being cached,
    // so the client can show real download progress instead of hanging.
    this.logger.log(
      `${videoId}: not cached, not in flight — starting live stream`,
    );
    const live = await this.musicCache.streamLive(videoId);
    this.logger.log(
      `${videoId}: streamLive resolved, mimeType=${live.mimeType} estimatedBytes=${live.estimatedBytes ?? '(none)'}`,
    );
    res.setHeader('Content-Type', live.mimeType);
    if (live.estimatedBytes) {
      res.setHeader('X-Estimated-Bytes', String(live.estimatedBytes));
      res.setHeader('Access-Control-Expose-Headers', 'X-Estimated-Bytes');
    }
    live.stream.on('error', (err) => {
      this.logger.error(`${videoId}: response stream errored: ${String(err)}`);
      res.destroy();
    });
    live.stream.on('close', () => {
      this.logger.log(`${videoId}: response stream closed`);
    });
    live.stream.pipe(res);
  }

  private serveCached(
    track: CachedTrack,
    range: string | undefined,
    ifNoneMatch: string | undefined,
    res: Response,
  ) {
    const { size, mtimeMs } = statSync(track.filePath);
    // Weak ETag off size+mtime — cheap (no hashing the file), and changes
    // whenever we re-download this videoId (e.g. after clearing a corrupt
    // cache entry), which `immutable, max-age=604800` alone could not: a
    // browser that had already cached the old (possibly bad) response
    // would trust it blindly for the full week and never even ask again,
    // regardless of what the server-side cache now holds. Confirmed live —
    // a stale browser cache kept "playing" a corrupt file after the whole
    // server-side cache directory had already been wiped.
    const etag = `W/"${size}-${Math.round(mtimeMs)}"`;

    res.setHeader('Content-Type', track.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    // "no-cache" is misleadingly named — it does NOT disable caching, it
    // means "you may reuse the cached body, but only after revalidating
    // with the server first (via If-None-Match)". A fresh max-age entry
    // would let the browser skip the network entirely, ETag or not, so
    // that's what actually needs to change here, not just adding ETag.
    res.setHeader('Cache-Control', 'public, no-cache');
    res.setHeader('ETag', etag);

    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }

    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (!match) {
      res.setHeader('Content-Length', size);
      createReadStream(track.filePath).pipe(res);
      return;
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : size - 1;
    if (start >= size || end >= size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    createReadStream(track.filePath, { start, end }).pipe(res);
  }
}
