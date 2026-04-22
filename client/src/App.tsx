import { useEffect, useState } from 'react'
import './App.css'
import { DiscordSDK } from '@discord/embedded-app-sdk'

function App() {
  const [text, setText] = useState("Not ready")

  useEffect(() => {
    const discordSdk = new DiscordSDK("1492382458899861504");
    async function setupDiscordSdk() {
      await discordSdk.ready();

      const { code } = await discordSdk.commands.authorize({
        client_id: "1492382458899861504",
        response_type: "code",
        state: "",
        prompt: "none",
        scope: [
          "identify",
          "guilds",
          "applications.commands"
        ],
      });

      const response = await fetch("/api/discord-auth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      const { access_token } = await response.json();

      // setText("Access token: " + access_token);
      const auth = await discordSdk.commands.authenticate({
        access_token,
      });

      if (auth) {
        setText("Authenticated: " + auth.user.username);
      } else {
        setText("Authentication failed");
      }
    }
    setupDiscordSdk();
  }, [])

  return (
    <>
      <section id="center">
        <h1>{text}</h1>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
