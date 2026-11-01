# Releases

Use the repository's devenv for development and `devenv shell -- bun test`
to run the suite. With `TOPH_VERDICT=1` the tests also check the proof
fixtures with `bend --verdict`, which needs Bend's Lean kernel built.

`devenv shell -- bun run release` builds the standalone executables into
`dist/release/` using the Bun version in `.bun-version`:

- `toph-<version>-macos-arm64`
- `toph-<version>-macos-x64`
- `toph-<version>-linux-x64`
- `toph-<version>-linux-arm64`

The version comes from `package.json`. The x64 targets use Bun's baseline
CPU builds and the Linux targets use glibc. Each binary embeds the checking
worker and Bend's compiler assets. The binaries aren't Developer ID signed or
notarized.

Check them with `shasum -a 256 -c SHA256SUMS` on macOS or
`sha256sum -c SHA256SUMS` on Linux, from inside `dist/release`. Building a
target doesn't run it, so try each binary on its platform before relying on it.

CI runs `bun test` on macOS and Linux for pushes and pull requests. The setup
action installs the exact Bun version and downloads Bend's release archive.
It reads Bend's commit from `devenv.lock`, gets the archive SHA-256 from
`flake.nix` at that commit, checks the version against `vendor/bend/version.json`,
and verifies the bytes before extraction. It installs the complete archive
layout so Bend can find its compiler and Base files.

To publish, enable GitHub Actions and allow the checkout and setup-bun
actions. Allow the release job's `GITHUB_TOKEN` to write repository contents.
Require the macOS and Linux test checks on the default branch, and restrict
creation of `v*` tags to maintainers.

Set the intended version in `package.json`, commit it with passing tests,
and create and push the matching `v<version>` tag. The release workflow runs
the tests on both systems, builds all four binaries, verifies the checksums,
and attaches them and `SHA256SUMS` to a GitHub release. A tag that disagrees
with `package.json` fails before building.

When updating Bend, update the devenv pin and lock together, refresh the vendor
tree with `bun scripts/vendor-bend.ts vX.Y.Z`, and update the documented requirement.
When updating Bun, update `.bun-version` alongside the devenv lock and verify
all release targets.
