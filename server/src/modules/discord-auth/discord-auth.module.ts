import { Module } from '@nestjs/common';
import { DiscordAuthController } from './discord-auth.controller';
import { DiscordAuthService } from './discord-auth.service';

@Module({
  controllers: [DiscordAuthController],
  providers: [DiscordAuthService],
})
export class DiscordAuthModule {}
