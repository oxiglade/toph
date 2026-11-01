{ pkgs, inputs, ... }:
{
  packages = [
    pkgs.bun
    inputs.bend.packages.${pkgs.stdenv.hostPlatform.system}.default
  ];
}
