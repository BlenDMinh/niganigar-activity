import { Module } from '@nestjs/common';
import { DiscordAuthModule } from './modules/discord-auth/discord-auth.module';
import { MusicModule } from './modules/music/music.module';
import { DiceGateway } from './gateway/dice.gateway';
import { SessionStoreService } from './state/session-store.service';

@Module({
  imports: [DiscordAuthModule, MusicModule],
  providers: [DiceGateway, SessionStoreService],
})
export class AppModule {}
