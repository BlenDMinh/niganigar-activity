import {
  BadRequestException,
  Controller,
  Get,
  Headers,
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
    @Res() res: Response,
  ) {
    if (!VIDEO_ID_RE.test(videoId)) {
      throw new BadRequestException('Invalid video id');
    }

    // Catalog songs are curated and few, so they're always kept. Custom
    // pasted links can be anything, so we track recency here and let the
    // cache service evict the oldest ones beyond its cap.
    if (customParam === '1') {
      await this.musicCache.touchCustom(videoId);
    }

    const cached = await this.musicCache.readCached(videoId);
    if (cached) {
      this.serveCached(cached, range, res);
      return;
    }

    if (this.musicCache.isDownloading(videoId)) {
      // Someone else already triggered this download — wait for it and
      // serve the finished file. No live progress for this caller, but
      // that's a rare race (two people picking a brand-new song within
      // the same few seconds) and it'll still play once ready.
      const track = await this.musicCache.getOrFetch(videoId);
      this.serveCached(track, undefined, res);
      return;
    }

    // First request for this video — stream live while it's being cached,
    // so the client can show real download progress instead of hanging.
    const live = await this.musicCache.streamLive(videoId);
    res.setHeader('Content-Type', live.mimeType);
    if (live.estimatedBytes) {
      res.setHeader('X-Estimated-Bytes', String(live.estimatedBytes));
      res.setHeader('Access-Control-Expose-Headers', 'X-Estimated-Bytes');
    }
    live.stream.on('error', () => res.destroy());
    live.stream.pipe(res);
  }

  private serveCached(
    track: CachedTrack,
    range: string | undefined,
    res: Response,
  ) {
    const { size } = statSync(track.filePath);

    res.setHeader('Content-Type', track.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');

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
