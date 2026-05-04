# discord-claude-full-mcp

A full-featured Discord MCP server for Claude (and any MCP-compatible client). Send and read messages, post images and files, drop server stickers, react with custom server emojis, set the bot's presence — and optionally send **real Discord voice notes** synthesised on the fly with ElevenLabs.

> **Heads up:** built and tested on **Windows**. It should work on Mac/Linux since it's plain Node.js + bundled `ffmpeg-static`, but I haven't verified those platforms. PRs welcome.

## Features

- `send_message` — text, with `:emoji_name:` shortcuts that resolve to your server's custom emojis, and optional reply-to
- `read_messages` — full message metadata (attachments, embeds, stickers, reactions, replies)
- `edit_message`, `delete_message`, `react_to_message`, `set_typing`
- `send_image`, `send_file` — local path or URL
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

```bash
git clone <your-fork>
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

## Use with Claude Desktop

Add to `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

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
claude mcp add discord node C:\\path\\to\\discord-claude-full-mcp\\build\\index.js
```

## Use from any MCP client

It's stdio-transport — point any MCP-compatible host at `node build/index.js`.

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
