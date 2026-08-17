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
import { MusicCacheService } from './music-cache.service';
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
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    if (!VIDEO_ID_RE.test(videoId)) {
      throw new BadRequestException('Invalid video id');
    }

    const track = await this.musicCache.getOrFetch(videoId);
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
