import { Module } from '@nestjs/common';
import { DiscordAuthModule } from './modules/discord-auth/discord-auth.module';

@Module({
  imports: [DiscordAuthModule],
})
export class AppModule {}
