import { Module } from '@nestjs/common';
import { MusicController } from './music.controller';
import { MusicCacheService } from './music-cache.service';
import { MusicCatalogService } from './music-catalog.service';
import { YoutubeAudioService } from './youtube-audio.service';

@Module({
  controllers: [MusicController],
  providers: [MusicCacheService, MusicCatalogService, YoutubeAudioService],
})
export class MusicModule {}
