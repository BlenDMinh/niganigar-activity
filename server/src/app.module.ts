import { Module } from '@nestjs/common';
import { DiscordAuthModule } from './modules/discord-auth/discord-auth.module';
import { DiceGateway } from './gateway/dice.gateway';
import { SessionStoreService } from './state/session-store.service';

@Module({
  imports: [DiscordAuthModule],
  providers: [DiceGateway, SessionStoreService],
})
export class AppModule {}
