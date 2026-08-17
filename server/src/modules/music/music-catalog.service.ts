import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type YTMusicType from 'ytmusic-api';

// ytmusic-api's CJS build sets `module.exports` to the class itself (no
// `.default`), but its .d.ts still describes an ESM-style default export —
// a dual-package hazard. A plain `require()` cast to the declared type
// matches the actual runtime shape; a normal `import` resolves to
// undefined here and throws "not a constructor".
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YTMusic = require('ytmusic-api') as typeof YTMusicType;

export interface CatalogSearchResult {
  videoId: string;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
}

// Resolves a search query (e.g. a song title) to a YouTube Music videoId —
// used when adding new tracks to the catalog by name instead of by pasting
// a direct link. It has no playback capability of its own.
@Injectable()
export class MusicCatalogService implements OnModuleInit {
  private readonly logger = new Logger(MusicCatalogService.name);
  private ytmusic!: YTMusicType;

  async onModuleInit() {
    this.ytmusic = new YTMusic();
    await this.ytmusic.initialize();
  }

  async search(query: string): Promise<CatalogSearchResult[]> {
    const results = await this.ytmusic.searchSongs(query);
    return results.slice(0, 8).map((song) => ({
      videoId: song.videoId,
      title: song.name,
      artist: song.artist.name,
      durationSeconds: song.duration,
    }));
  }
}
