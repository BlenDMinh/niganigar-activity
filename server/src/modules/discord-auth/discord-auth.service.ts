import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DiscordAuthService {
  private readonly logger = new Logger(DiscordAuthService.name);

  async exchangeCodeForToken(code: string) {
    this.logger.log('Exchanging OAuth code for access token');

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.VITE_DISCORD_CLIENT_ID ?? '',
        client_secret: process.env.DISCORD_CLIENT_SECRET ?? '',
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `Token exchange failed: ${response.status} ${response.statusText}`,
      );
    } else {
      this.logger.log('Token exchange successful');
    }

    const { access_token } = (await response.json()) as {
      access_token: string;
    };
    return { access_token };
  }
}
