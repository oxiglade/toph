import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { archiveSpec, verifyArchive } from "../scripts/install-bend.ts";

test("Bend installation rejects wrong versions, missing targets and malformed hashes", () => {
  const flake = 'ver = "2.0.39"; archives = { x86_64-linux = { target = "linux-x64"; sha256 = "' + "a".repeat(64) + '"; }; };';
  expect(archiveSpec(flake, "linux-x64", "2.0.39")).toEqual({
    url: "https://github.com/bendlang/bend/releases/download/v2.0.39/bend-2.0.39-linux-x64.tar.gz",
    sha256: "a".repeat(64),
  });
  expect(() => archiveSpec(flake, "linux-arm64", "2.0.39")).toThrow("checksum");
  expect(() => archiveSpec(flake, "linux-x64", "2.0.38")).toThrow("version");
  expect(() => archiveSpec(flake.replace("a".repeat(64), "abc"), "linux-x64", "2.0.39")).toThrow("checksum");
});

test("Bend installation refuses a corrupted archive before extraction", () => {
  const bytes = new TextEncoder().encode("release archive");
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(() => verifyArchive(bytes, hash)).not.toThrow();
  bytes[0] ^= 1;
  expect(() => verifyArchive(bytes, hash)).toThrow("SHA-256 mismatch");
});
