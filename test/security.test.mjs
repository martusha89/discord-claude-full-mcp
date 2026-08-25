import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  isPathWithinRoot,
  isPublicIpAddress,
  loadLocalAttachment,
  resolveRedirectUrl,
} from "../build/discord/attachments.js";
import {
  bearerTokenMatches,
  httpAuthConfigurationError,
  originAllowed,
} from "../build/http-security.js";

test("private, loopback, link-local and reserved addresses are blocked", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b:1::c0a8:101",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("local attachment roots reject siblings and their root directory", () => {
  const root = path.resolve("C:/approved");
  assert.equal(isPathWithinRoot(root, path.join(root, "photo.png")), true);
  assert.equal(isPathWithinRoot(root, root), false);
  assert.equal(
    isPathWithinRoot(root, path.resolve("C:/approved-sibling/secret.txt")),
    false
  );
});

test("local attachment reads are handle-bound and enforce the byte ceiling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "discord-mcp-attachment-"));
  try {
    const small = path.join(root, "small.txt");
    const large = path.join(root, "large.txt");
    await writeFile(small, "safe content");
    await writeFile(large, "x".repeat(33));

    const result = await loadLocalAttachment(small, {
      allowedFileRoots: [root],
      maxBytes: 32,
    });
    assert.equal(result.toString(), "safe content");
    await assert.rejects(
      loadLocalAttachment(large, {
        allowedFileRoots: [root],
        maxBytes: 32,
      }),
      /size ceiling/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP mode always requires a strong bearer token", () => {
  assert.match(httpAuthConfigurationError("http", "short"), /at least 32/);
  assert.match(httpAuthConfigurationError("sse", ""), /at least 32/);
  assert.equal(httpAuthConfigurationError("stdio", ""), null);
  assert.equal(httpAuthConfigurationError("http", "x".repeat(32)), null);

  const token = "a".repeat(32);
  assert.equal(bearerTokenMatches(`Bearer ${token}`, token), true);
  assert.equal(bearerTokenMatches("Bearer wrong", token), false);
  assert.equal(bearerTokenMatches(undefined, token), false);
});

test("CORS origins fail closed when an Origin header is present", () => {
  const allowed = ["https://claude.ai"];
  assert.equal(originAllowed(undefined, allowed), true);
  assert.equal(originAllowed("https://claude.ai", allowed), true);
  assert.equal(originAllowed("https://evil.example", allowed), false);
});

test("malformed attachment redirects become controlled errors", () => {
  assert.throws(
    () => resolveRedirectUrl("https://[invalid", new URL("https://example.com")),
    /invalid redirect location/
  );
  assert.equal(
    resolveRedirectUrl("/next", new URL("https://example.com/start")).href,
    "https://example.com/next"
  );
});
