import { CommandBuilder } from "../src/CommandHandler.mjs";

const SIDECAR_URL = process.env.STREAM_RESOLVER_URL || 'http://127.0.0.1:3100';

export const command = new CommandBuilder()
  .setName("jwt")
  .setDescription("Set a JWT for the Monochrome stream resolver sidecar.")
  .setCategory("util")
  .addRequirement(r => r.setOwnerOnly(true))
  .addStringOption(o =>
    o.setName("token")
      .setDescription("The JWT token from monochrome.tf")
      .setRequired(false));

export const run = async function (msg, data) {
  const token = data.get("token")?.value;

  if (!token) {
    msg.replyEmbed(
      "Provide a JWT token from monochrome.tf.\n" +
      "Usage: `!jwt <token>`\n\n" +
      "To get a token:\n" +
      "1. Open a browser with your VPS IP (use SOCKS proxy if needed)\n" +
      "2. Go to https://monochrome.tf\n" +
      "3. Solve the Turnstile captcha\n" +
      "4. Copy the JWT from DevTools → Application → Local Storage\n" +
      "5. Run `!jwt <paste-token>`"
    );
    return;
  }

  const cleaned = token.replace(/[\s'"]/g, '').trim();

  if (!cleaned.startsWith('eyJ')) {
    msg.replyEmbed("Invalid JWT format. Token must start with `eyJ`.", false, { colour: "red" });
    return;
  }

  try {
    const resp = await fetch(`${SIDECAR_URL}/setjwt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: cleaned }),
    });

    const result = await resp.json();

    if (result.ok) {
      msg.replyEmbed(
        `JWT set successfully.\nExpires: ${result.expiresAt}`,
        false,
        { colour: "green" }
      );

      if (this.pm) {
        const monochrome = this.pm.providers.find(p => p.name === 'monochrome');
        if (monochrome) monochrome.markJwtValid();
        this.pm.invalidateHealth('monochrome');
        const results = await this.pm.forceCheck();
        const onlineCount = this.pm.getOnlineCount();
        const names = Object.entries(results)
          .filter(([, v]) => v.online)
          .map(([k]) => k);

        try {
          await this.client.user.edit({
            status: {
              presence: onlineCount > 0 ? 'Online' : 'Focus',
              text: onlineCount > 0
                ? `${onlineCount} relay${onlineCount > 1 ? 's' : ''} online`
                : 'All relays offline'
            }
          });
        } catch (e) {
          console.error('[JWT] Presence update failed:', e.message);
        }

        console.log(`[JWT] Health recheck: ${onlineCount}/${results.length} online (${names.join(', ') || 'none'})`);
      }
    } else {
      msg.replyEmbed(
        `Failed to set JWT: \`${result.error}\``,
        false,
        { colour: "red" }
      );
    }
  } catch (e) {
    msg.replyEmbed(
      `Could not reach sidecar at \`${SIDECAR_URL}\`: \`${e.message}\``,
      false,
      { colour: "red" }
    );
  }
};
