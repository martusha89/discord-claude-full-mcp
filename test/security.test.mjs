import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress } from "../build/discord/attachments.js";
import { assertChannelAllowed, assertDmAllowed } from "../build/discord/policy.js";
import { bearerMatches } from "../build/http-security.js";
import { normalizeTransport } from "../build/config.js";

const policy = { allowedGuildIds: ["11111111111111111"], allowedChannelIds: ["22222222222222222"], allowedDmUserIds: ["33333333333333333"], allowLocalFiles: false, allowedLocalRoots: [], remoteMode: true };
test("blocks non-public address ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "ff02::1"]) assert.equal(isBlockedAddress(ip), true, ip);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
});
test("channel IDs cannot bypass guild policy", () => {
  assert.doesNotThrow(() => assertChannelAllowed(policy, "22222222222222222", "11111111111111111"));
  assert.throws(() => assertChannelAllowed(policy, "22222222222222222", "99999999999999999"));
  assert.throws(() => assertChannelAllowed(policy, "99999999999999999", "11111111111111111"));
});
test("DM recipients are deny-by-default", () => {
  assert.doesNotThrow(() => assertDmAllowed(policy, "33333333333333333"));
  assert.throws(() => assertDmAllowed(policy, "99999999999999999"));
});
test("a DM-only remote policy does not open every guild or channel", () => {
  const dmOnly = { ...policy, allowedGuildIds: [], allowedChannelIds: [] };
  assert.throws(() => assertChannelAllowed(dmOnly, "22222222222222222", "11111111111111111"));
});
test("bearer parser is exact", () => {
  assert.equal(bearerMatches("Bearer a-secret-token", "a-secret-token"), true);
  assert.equal(bearerMatches("bearer a-secret-token", "a-secret-token"), false);
  assert.equal(bearerMatches("Bearer wrong", "a-secret-token"), false);
});
test("transport aliases normalize", () => {
  assert.equal(normalizeTransport("streamable-http"), "http");
  assert.equal(normalizeTransport("http"), "http");
  assert.equal(normalizeTransport("sse"), "http");
  assert.equal(normalizeTransport(undefined), "stdio");
  assert.throws(() => normalizeTransport("websocket"));
});
