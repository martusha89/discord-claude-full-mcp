# discord-claude-full-mcp

A security-conscious Discord MCP server for Claude and other MCP clients. It can read and send messages, files, stickers, reactions, DMs, and optional ElevenLabs-generated Discord voice messages.

## Features

- Send, read, edit, delete, reply to, and react to messages
- Send images/files from validated URLs; optional restricted local files in stdio mode
- List allowed servers, channels, emojis, and stickers; send stickers and set presence
- Send Direct Messages to explicitly allowed recipients
- **Send Voice Messages** using ElevenLabs TTS and bounded ffmpeg processing
- stdio and authenticated Streamable HTTP transports

## Requirements and install

- Node.js 20 or newer
- Discord bot token, with only the permissions needed for enabled tools
- Message Content privileged intent if reading other users' message text
- Optional ElevenLabs API key and voice ID

```bash
git clone <your-fork>
cd discord-claude-full-mcp
npm install
npm run build
cp .env.example .env
cp config.example.json config.json
```

## Exact configuration

`.env` contains secrets and process/network settings. `config.json` contains Discord policy and limits. Both are loaded from the project root; `MCP_CONFIG_PATH` can override the config path.

Required: `DISCORD_TOKEN`. Voice messages additionally require both `ELEVENLABS_API_KEY` and `elevenlabs.voiceId`.

Policy fields:

- `allowedGuildIds`: permitted Discord guild IDs. Empty means all guilds only in local stdio mode.
- `allowedChannelIds`: optional channel restriction. A direct channel ID is still checked against both channel and guild policy.
- `allowedDmUserIds`: exact DM recipient IDs; empty disables DMs.
- `allowLocalFiles`: defaults false. Local paths are always rejected in HTTP mode.
- `allowedLocalRoots`: required when local files are enabled. Real paths are checked after symlink resolution.

Limits are shown with defaults in `config.example.json`. Messages and TTS text are bounded, mentions are suppressed by default, replies fail if the referenced message is absent, network work has timeouts/byte limits, and voice work has a concurrency cap. Typing delay defaults off; set min/max milliseconds to enable it.

For the safest setup, copy `config.example.json` and replace every placeholder snowflake. HTTP mode refuses to start without a non-empty target allowlist and a bearer token of at least 24 characters.

## stdio (Claude Desktop/Code)

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

The server does not call the Claude API. Claude Desktop/Code supplies the model and invokes MCP tools separately; this project only connects MCP requests to Discord (and ElevenLabs when configured).

## Streamable HTTP

Set:

```dotenv
MCP_TRANSPORT=streamable-http
MCP_HOST=127.0.0.1
MCP_PORT=3001
MCP_HTTP_BEARER_TOKEN=<strong-random-secret>
MCP_ALLOWED_ORIGINS=https://claude.ai
MCP_RATE_LIMIT_PER_MINUTE=60
```

`http` is equivalent; `sse` is a deprecated compatibility alias. The default loopback bind is intentional. `/mcp` requires `Authorization: Bearer ...`; browser Origins must exactly match `MCP_ALLOWED_ORIGINS`. CORS is never wildcard. A global application-level rate limit defaults to 60 requests per minute. `/health` reports only process liveness and `/ready` reports Discord readiness.

Do not directly publish this process or use an unauthenticated tunnel. Put it behind TLS and an authenticated reverse proxy that preserves the Authorization header, enforces request/rate limits, and restricts source access. A static bearer token is not OAuth: MCP hosts/connectors that require OAuth discovery and authorization will need an OAuth-capable gateway rather than this server alone.

## Attachment safety

URL attachments permit only HTTP(S), resolve DNS before each request, reject private/loopback/link-local/multicast/metadata address ranges, manually revalidate redirects, and enforce timeout and byte limits. DNS rebinding protection is best-effort with platform `fetch`; a hardened egress proxy/firewall is recommended for high-assurance remote deployments.

Local files are explicit opt-in, async, size-bounded, and constrained to real paths below configured roots. They are unavailable over Streamable HTTP regardless of configuration.

## Voice messages

ElevenLabs output is downloaded with timeout and size bounds. Two ffmpeg processes create OGG/Opus audio and waveform PCM; each has a timeout, and `voiceConcurrency` limits simultaneous jobs. `send_voice_note` is hidden when ElevenLabs is not fully configured.

## Development

```bash
npm test
```

CI runs build and Node's built-in tests on Node 20 and 22.

## License

MIT — Marta Varen.
