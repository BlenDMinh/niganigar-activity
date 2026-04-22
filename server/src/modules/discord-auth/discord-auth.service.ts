import { Injectable } from "@nestjs/common";

@Injectable()
export class DiscordAuthService {
  async exchangeCodeForToken(code: string) {
    const response = await fetch(`https://discord.com/api/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "1492382458899861504",
        client_secret: "YUvKJRTbgAdpUWccvauB09PwPVfqwnqk",
        grant_type: "authorization_code",
        code: code,
      }),
    });

    const { access_token } = await response.json();
    return { access_token };
  }
}
