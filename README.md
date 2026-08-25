<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:8B5CF6,100:22D3EE&height=170&section=header&text=discord-claude-full-mcp&fontColor=ffffff&fontSize=28&fontAlignY=40&desc=A%20full-featured%20Discord%20MCP%20server%20for%20Claude&descSize=17&descAlignY=64" width="100%" />

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#)
[![MCP](https://img.shields.io/badge/MCP-server-8B5CF6?style=for-the-badge)](https://modelcontextprotocol.io)
[![license MIT](https://img.shields.io/badge/license-MIT-A855F7?style=for-the-badge)](LICENSE)

</div>

A full-featured Discord MCP server for Claude (and any MCP-compatible client). Send and read messages, post images and files, drop server stickers, react with custom server emojis, set the bot's presence — and optionally send **real Discord voice notes** synthesised on the fly with ElevenLabs.

> **Heads up:** built and tested on **Windows**. It should work on Mac/Linux since it's plain Node.js + bundled `ffmpeg-static`, but I haven't verified those platforms. PRs welcome.

## Features

- `send_message` — text, with `:emoji_name:` shortcuts that resolve to your server's custom emojis, and optional reply-to
- `send_direct_message` — send a DM using a locally resolved privacy alias or an owner-supplied user ID
- `read_messages` — privacy-redacted text plus actual image content, stable aliases and reply context
- `edit_message`, `delete_message`, `react_to_message`, `set_typing`
- `send_image`, `send_file` — approved local roots or public HTTPS URLs
- `send_sticker` — server stickers by ID
- `list_servers`, `list_channels`, `list_emojis`, `list_stickers`
- `set_status` — online/idle/dnd/invisible plus activity text
- `send_voice_note` *(optional)* — text → ElevenLabs TTS → real Discord voice message with proper waveform bars

If you don't configure ElevenLabs, `send_voice_note` is simply not advertised — every other tool keeps working.

## Requirements

- Node.js 18+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- *(Optional)* ElevenLabs API key + voice ID for voice notes

### Bot permissions

Invite the bot with at least:

- Read Messages / View Channels
- Send Messages
- Read Message History
- Add Reactions
- Use External Emojis (helpful)
- Attach Files
- Manage Messages (only if you want delete on others' messages — usually not)

You'll also need the **Message Content** privileged intent enabled in the developer portal if you want `read_messages` to return text content for non-bot messages.

## Install

From npm (no clone needed, your MCP host runs it via `npx`):

```bash
npx -y discord-claude-full-mcp
```

Or from source:

```bash
git clone https://github.com/martusha89/discord-claude-full-mcp.git
cd discord-claude-full-mcp
npm install
npm run build
```

## Configure

Copy the examples:

```bash
cp .env.example .env
cp config.example.json config.json
```

Fill in `.env`:

```
DISCORD_TOKEN=...
ELEVENLABS_API_KEY=          # leave blank to disable voice notes
```

Edit `config.json` only if you want voice notes or default-server behaviour:

```json
{
  "elevenlabs": {
    "voiceId": "your_voice_id_here",
    "modelId": "eleven_turbo_v2_5",
    "stability": 0.5,
    "similarityBoost": 0.75,
    "style": 0.0,
    "useSpeakerBoost": true
  },
  "defaults": {
    "guildId": "optional_default_server_id"
  }
}
```

`defaults.guildId` is what the server uses if a tool call omits the `server` argument and the bot is in more than one server.

### Privacy modes

`read_messages` defaults to `DISCORD_PRIVACY_MODE=redacted`. The model receives message text **and the actual pixels of supported image attachments**, plus stable local aliases such as `User-A1B2C3D4E5F6`, timestamps and reply relationships. It does not receive Discord user IDs/tags, raw message IDs, signed attachment URLs or embed bodies. Discord mentions inside message text are converted to aliases. The bridge keeps alias mappings in memory so DMs, replies, edits, reactions and deletion still work without revealing the underlying IDs to the model.

- `metadata` — aliases and structural metadata only; message text and image pixels are omitted
- `redacted` — conversational text and image pixels with private identifiers and URLs removed (default)
- `full` — original full-fidelity Discord data plus image pixels, explicitly selected by the owner

Alias labels remain stable across restarts, but the private reverse-routing maps are deliberately memory-only: after a restart, read the relevant message again before using an old alias for a DM, reply, edit, reaction or deletion. Set `DISCORD_PRIVACY_ALIAS_KEY` if the labels themselves must also survive a Discord-token rotation.

Local attachments are disabled until `DISCORD_ALLOWED_FILE_ROOTS` contains one or more approved directories. Remote attachments require public HTTPS, block private/reserved network addresses and have a configurable memory ceiling (`DISCORD_MAX_ATTACHMENT_BYTES`, default 25 MiB).

#### Reduced provider data by default

Redaction happens inside this local MCP process **before** a `read_messages` result is returned to Claude or another model provider. In the default `redacted` mode:

| Discord data | Sent to the model provider? |
| --- | --- |
| Message text | Yes — the remote model needs this to understand the conversation |
| Stable local user aliases | Yes |
| Image pixels from supported attachments | Yes — embedded directly as MCP image content |
| Discord usernames, tags and user IDs | No |
| Raw Discord message IDs | No — local message aliases preserve replies and edits |
| User, role and channel IDs inside Discord mentions | No — converted to aliases or generic labels |
| Attachment names, types and sizes | Yes |
| Attachment URLs, waveform data and signed CDN links | No |
| Embed bodies and URLs | No |

Supported PNG, JPEG, GIF and WebP uploads, embed images/thumbnails and raster Discord stickers are downloaded locally, checked by an actual bounded FFmpeg decode rather than trusting their MIME label, stripped of their source URL, and embedded in the MCP response. Their pixels therefore reach the configured model provider so the AI can genuinely inspect them. Lottie/JSON stickers, AVIF/HEIC and other provider-dependent formats are reported but not emitted as misleading “supported” image blocks. Set `DISCORD_INCLUDE_IMAGES=false` to opt out, or use `metadata` mode to omit both text and images. The combined image payload and decoded pixel count have configurable technical ceilings.

Server and channel names are still returned when their discovery tools are explicitly called because the model needs them for navigation. Their raw IDs become reversible local aliases such as `Server-...` and `Channel-...`, so duplicate names remain usable without exposing the underlying IDs; `full` mode returns the originals. Voice-note text is sent to ElevenLabs only when `send_voice_note` is invoked. Use `full` only when the owner deliberately wants the original Discord payload.

### Configuring without a config file

If you installed from npm there is nowhere sensible to put a `config.json`, so every setting that matters is also readable from the environment. Env vars win over the file:

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | **Required.** Bot token. |
| `ELEVENLABS_API_KEY` | Enables `send_voice_note`. |
| `ELEVENLABS_VOICE_ID` | Voice used for voice notes. Required alongside the key. |
| `ELEVENLABS_MODEL_ID` | Defaults to `eleven_turbo_v2_5`. |
| `DISCORD_DEFAULT_GUILD_ID` | Server assumed when a tool call omits `server`. |
| `DISCORD_PRIVACY_MODE` | `redacted` (default), `metadata`, or `full`. |
| `DISCORD_PRIVACY_ALIAS_KEY` | Optional secret for aliases that survive bot-token rotation. |
| `DISCORD_INCLUDE_IMAGES` | Include image pixels in `read_messages`; defaults to `true`. |
| `DISCORD_MAX_IMAGE_CONTEXT_BYTES` | Combined technical image ceiling per read; default 25 MiB. |
| `DISCORD_MAX_IMAGE_PIXELS` | Safe decode ceiling per image; default 40 megapixels. |
| `DISCORD_IMAGE_READ_TIMEOUT_MS` | Overall image processing deadline per read; default 30 seconds. |
| `DISCORD_ALLOWED_FILE_ROOTS` | Comma-separated directories permitted for local attachments. |
| `DISCORD_MAX_ATTACHMENT_BYTES` | Technical attachment memory ceiling; default 25 MiB. |

## Use with Claude Desktop

Add to `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "discord": {
      "command": "npx",
      "args": ["-y", "discord-claude-full-mcp"],
      "env": {
        "DISCORD_TOKEN": "your_discord_bot_token_here"
      }
    }
  }
}
```

Running from a local clone instead:

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["C:\\path\\to\\discord-claude-full-mcp\\build\\index.js"]
    }
  }
}
```

## Use with Claude Code

```bash
claude mcp add discord --env DISCORD_TOKEN=your_token_here -- npx -y discord-claude-full-mcp
```

## Use from any MCP client

It's stdio-transport — point any MCP-compatible host at `node build/index.js`.

## Use with claude.ai (browser & mobile app)

The server supports **Streamable HTTP transport** for use directly in claude.ai — both browser and the Claude mobile app.

1. Set transport mode and an auth token in `.env`:

```
MCP_TRANSPORT=sse
MCP_PORT=3001
MCP_AUTH_TOKEN=<long random secret>
```

Generate a token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The `/mcp` endpoint gives full control of your Discord bot. HTTP mode therefore refuses to start without an `MCP_AUTH_TOKEN` of at least 32 characters, even on loopback: tunnels and reverse proxies can expose a loopback listener. Every `/mcp` and `/health` request needs an `Authorization: Bearer <token>` header. Browser `OPTIONS` preflight is the sole unauthenticated exception; it performs no MCP action and returns no operational data. Authentication runs before JSON body parsing. Use TLS or a trusted TLS-terminating tunnel because bearer authentication does not encrypt plaintext HTTP.

2. Run the server:

```bash
npm run build && node build/index.js
```

3. Expose it publicly (e.g. via ngrok):

```bash
ngrok http 3001
```

ngrok will display a public URL like `https://abc123.ngrok-free.dev`. Copy it.

4. Add to claude.ai: **Settings → Connectors → Add custom connector**
   - URL: your ngrok URL + `/mcp`, e.g. `https://abc123.ngrok-free.dev/mcp`
   - **Important:** don't forget the `/mcp` at the end!
   - Configure `Authorization: Bearer <your token>`. If the client cannot send authentication headers, do not expose this endpoint with a public tunnel.

The server runs in stateless mode: each request gets its own server instance. An authenticated, metadata-free health check is available at `/health`. Cross-origin requests are only allowed from `https://claude.ai` and `https://claude.com` by default (override with `MCP_ALLOWED_ORIGINS`).

### Privacy boundary

Redaction happens locally before a tool result is returned. Message text and included image pixels become model context and may be processed by the configured model provider; private Discord identifiers and signed CDN URLs do not need to accompany them. A remote model cannot reason about content that is cryptographically hidden from it, so use `metadata` mode or disable images when that content must not leave the machine. Voice-note text is additionally sent to ElevenLabs before Discord.

## How voice notes work

1. Tool receives text.
2. ElevenLabs renders MP3.
3. `ffmpeg-static` (bundled) transcodes MP3 → OGG/Opus mono and produces an analysis-grade PCM stream.
4. Server samples 256 amplitude peaks from the PCM, normalises them to 0–255, base64-encodes the byte array — that's the waveform Discord renders as bars.
5. POST to Discord with `IS_VOICE_MESSAGE` flag and per-attachment `duration_secs` + `waveform`.

Result: a Discord voice message indistinguishable from a real recording, with accurate-looking bars.

## Notes & limitations

- Built and tested on Windows only.
- The voice-note pipeline runs `ffmpeg` twice (transcode + amplitude analysis) — this is in-memory and fast, but for very long texts you'll feel it.
- `send_voice_note` is hidden from the tool list when ElevenLabs is not configured. There's no half-broken state.
- This server does **not** implement: voice channel join/speak, slash command registration, role/permission management. Those are out of scope.

## License

MIT — Marta Varen.
