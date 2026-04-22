import { Body, Controller, Post } from "@nestjs/common";
import { DiscordAuthService } from "./discord-auth.service";

@Controller("discord-auth")
export class DiscordAuthController {
  constructor(private readonly discordAuthService: DiscordAuthService) {}

  @Post("token")
  async exchangeCodeForToken(@Body("code") code: string) {
    return this.discordAuthService.exchangeCodeForToken(code);
  }
}
