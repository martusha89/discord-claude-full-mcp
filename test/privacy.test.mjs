import assert from "node:assert/strict";
import test from "node:test";

import {
  aliasForMessage,
  aliasForUser,
  configurePrivacy,
  resolveServerReference,
  resolveMessageReference,
  resolveRecipient,
} from "../build/privacy.js";
import {
  buildReadMessagesMcpContent,
  collectMessageImages,
  formatMessage,
  imageMimeTypeFromBuffer,
  modelImageMimeType,
} from "../build/discord/messages.js";
import { createClient } from "../build/discord/client.js";
import { listServers } from "../build/discord/meta.js";
import { validateDecodableImage } from "../build/image-validation.js";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function collection(values) {
  return {
    size: values.length,
    map(callback) {
      return values.map(callback);
    },
    values() {
      return values.values();
    },
  };
}

function fakeMessage() {
  return {
    id: "message-1",
    author: { id: "123456789012345678", tag: "PrivateName#1234", bot: false },
    content:
      "The actual conversation <@123456789012345678> https://cdn.discordapp.com/attachments/1/2/private.png?token=secret https://cdn.discordapp.com/ephemeral-attachments/1/2/private.png?token=secret",
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
    editedAt: null,
    attachments: collection([
      {
        id: "attachment-1",
        name: "photo-123456789012345678.png",
        url: "https://private.example/signed-url",
        contentType: "image/png",
        size: 42,
        flags: { bitfield: 0 },
        duration: null,
        waveform: "private-waveform",
      },
    ]),
    embeds: [{ title: "Private embed", description: "Private body" }],
    stickers: collection([{ id: "sticker-1", name: "Wave" }]),
    reactions: { cache: collection([{ emoji: { name: "heart", toString: () => "❤️" }, count: 2 }]) },
    reference: { messageId: "message-0" },
    pinned: false,
  };
}

test("aliases are stable and resolve locally without exposing the user ID", () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const first = aliasForUser("123456789012345678");
  const second = aliasForUser("123456789012345678");

  assert.equal(first, second);
  assert.match(first, /^User-[A-F0-9]{12}$/);
  assert.equal(resolveRecipient(first.toLowerCase()), "123456789012345678");

  const messageAlias = aliasForMessage("987654321098765432");
  assert.match(messageAlias, /^Message-[A-F0-9]{12}$/);
  assert.equal(
    resolveMessageReference(messageAlias),
    "987654321098765432"
  );

  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  assert.equal(aliasForUser("123456789012345678"), first);
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  assert.throws(() => resolveRecipient(first), /Unknown recipient alias/);
});

test("redacted mode preserves context but removes identity and attachment URLs", () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const output = formatMessage(fakeMessage());
  const serialized = JSON.stringify(output);

  assert.match(output.content, /The actual conversation @User-/);
  assert.match(output.content, /Discord attachment link omitted/);
  assert.match(output.id, /^Message-/);
  assert.match(output.reference, /^Message-/);
  assert.match(output.author.alias, /^User-/);
  assert.equal(serialized.includes("PrivateName"), false);
  assert.equal(serialized.includes("123456789012345678"), false);
  assert.equal(serialized.includes("signed-url"), false);
  assert.equal(serialized.includes("ephemeral-attachments"), false);
  assert.equal(serialized.includes("Private embed"), false);
});

test("metadata mode omits message content", () => {
  configurePrivacy({ mode: "metadata", aliasKey: "test-key" });
  const output = formatMessage(fakeMessage());

  assert.equal(output.contentOmitted, true);
  assert.equal(output.contentLength, fakeMessage().content.length);
  assert.equal("content" in output, false);
});

test("full mode remains an explicit owner-controlled option", () => {
  configurePrivacy({ mode: "full", aliasKey: "test-key" });
  const output = formatMessage(fakeMessage());

  assert.equal(output.author.id, "123456789012345678");
  assert.equal(output.author.tag, "PrivateName#1234");
  assert.equal(output.attachments[0].url, "https://private.example/signed-url");
});

test("server discovery uses locally reversible aliases unless full mode is selected", async () => {
  const client = createClient();
  client.guilds.cache.set("123456789012345678", {
    id: "123456789012345678",
    name: "Allowed server",
    memberCount: 4,
  });

  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const [redacted] = await listServers();
  assert.match(redacted.id, /^Server-[A-F0-9]{12}$/);
  assert.notEqual(redacted.id, "123456789012345678");
  assert.equal(resolveServerReference(redacted.id), "123456789012345678");
  assert.equal(redacted.name, "Allowed server");

  configurePrivacy({ mode: "full", aliasKey: "test-key" });
  const [full] = await listServers();
  assert.equal(full.id, "123456789012345678");
  client.destroy();
});

test("redacted reads embed image pixels without exposing the Discord URL", async () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const downloadCalls = [];
  const { images, imageErrors } = await collectMessageImages([fakeMessage()], {
    enabled: true,
    maxTotalBytes: 1024,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 30_000,
    downloader: async (url, ceiling) => {
      downloadCalls.push({ url: url.href, ceiling });
      return VALID_PNG;
    },
  });

  assert.equal(images.length, 1);
  assert.equal(imageErrors.length, 0);
  assert.equal(downloadCalls.length, 1);
  const content = buildReadMessagesMcpContent({
    payload: { includedImages: [{ index: 1, message: images[0].message }] },
    images,
  });
  const imageBlock = content.find((block) => block.type === "image");
  assert.equal(imageBlock.mimeType, "image/png");
  assert.deepEqual(Buffer.from(imageBlock.data, "base64"), VALID_PNG);
  assert.equal(JSON.stringify(content).includes("signed-url"), false);
});

test("metadata mode never downloads or embeds image pixels", async () => {
  configurePrivacy({ mode: "metadata", aliasKey: "test-key" });
  let downloaded = false;
  const result = await collectMessageImages([fakeMessage()], {
    enabled: true,
    maxTotalBytes: 1024,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 30_000,
    downloader: async () => {
      downloaded = true;
      return Buffer.from("should-not-run");
    },
  });
  assert.equal(downloaded, false);
  assert.equal(result.images.length, 0);
});

test("the explicit image opt-out never downloads image pixels", async () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  let downloaded = false;
  const result = await collectMessageImages([fakeMessage()], {
    enabled: false,
    maxTotalBytes: 1024,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 30_000,
    downloader: async () => {
      downloaded = true;
      return VALID_PNG;
    },
  });
  assert.equal(downloaded, false);
  assert.equal(result.images.length, 0);
});

test("full mode retains original metadata and still embeds image pixels", async () => {
  configurePrivacy({ mode: "full", aliasKey: "test-key" });
  const result = await collectMessageImages([fakeMessage()], {
    enabled: true,
    maxTotalBytes: 1024,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 30_000,
    downloader: async () => VALID_PNG,
    validator: async () => undefined,
  });
  assert.equal(result.images.length, 1);
  assert.equal(formatMessage(fakeMessage()).attachments[0].url.includes("signed-url"), true);
});

test("embed images, thumbnails and raster stickers are included for vision", async () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const message = fakeMessage();
  message.attachments = collection([]);
  message.embeds = [
    {
      title: "Shared artwork",
      image: {
        url: "http://origin.example/full.png",
        proxyURL: "https://images.example/full.png",
      },
      thumbnail: {
        url: "http://origin.example/thumb.png",
        proxyURL: "https://images.example/thumb.png",
      },
    },
  ];
  message.stickers = collection([
    { name: "Raster sticker", format: 1, url: "https://images.example/sticker.png" },
    { name: "Lottie sticker", format: 3, url: "https://images.example/sticker.json" },
  ]);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const downloadedUrls = [];
  const result = await collectMessageImages([message], {
    enabled: true,
    maxTotalBytes: 1024,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 30_000,
    downloader: async (url) => {
      downloadedUrls.push(url.href);
      return png;
    },
    validator: async () => undefined,
  });

  assert.equal(result.images.length, 3);
  assert.deepEqual(
    result.images.map((image) => image.name),
    ["embed-1-image", "embed-1-thumbnail", "Raster sticker"]
  );
  assert.equal(downloadedUrls.includes("http://origin.example/full.png"), false);
  assert.equal(downloadedUrls.includes("https://images.example/full.png"), true);
});

test("image validation requires a genuinely decodable image", async () => {
  await validateDecodableImage(VALID_PNG, 40_000_000);
  await assert.rejects(
    validateDecodableImage(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from("not-a-real-png"),
      ]),
      40_000_000
    ),
    /could not be decoded safely/
  );
  const avifHeader = Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftypavif", "ascii"),
  ]);
  assert.equal(
    modelImageMimeType({ contentType: "image/avif", name: "photo.avif" }),
    "image/avif"
  );
  assert.equal(imageMimeTypeFromBuffer(avifHeader), null);
});

test("image collection stops at the configured overall deadline", async () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const message = fakeMessage();
  message.attachments = collection([
    { name: "one.png", contentType: "image/png", size: 8, url: "https://images.example/one.png" },
    { name: "two.png", contentType: "image/png", size: 8, url: "https://images.example/two.png" },
  ]);
  let calls = 0;
  const result = await collectMessageImages([message], {
    enabled: true,
    maxTotalBytes: 1024,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 100,
    downloader: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return VALID_PNG;
    },
    validator: async () => undefined,
  });

  assert.equal(calls, 1);
  assert.equal(result.images.length, 0);
  assert.match(result.imageErrors.at(-1).reason, /overall deadline/);
});

test("the combined image byte budget stops additional downloads", async () => {
  configurePrivacy({ mode: "redacted", aliasKey: "test-key" });
  const message = fakeMessage();
  message.attachments = collection([
    { name: "one.png", contentType: "image/png", size: VALID_PNG.length, url: "https://images.example/one.png" },
    { name: "two.png", contentType: "image/png", size: VALID_PNG.length, url: "https://images.example/two.png" },
  ]);
  let calls = 0;
  const result = await collectMessageImages([message], {
    enabled: true,
    maxTotalBytes: VALID_PNG.length,
    maxPerImageBytes: 1024,
    maxImagePixels: 40_000_000,
    maxCollectionMs: 30_000,
    downloader: async () => {
      calls += 1;
      return VALID_PNG;
    },
    validator: async () => undefined,
  });
  assert.equal(calls, 1);
  assert.equal(result.images.length, 1);
  assert.match(result.imageErrors[0].reason, /byte ceiling/);
});
