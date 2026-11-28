const repository = "https://github.com/HakuCasey/SolveMate";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const suffixes = new Map([
  ["darwin-arm64", "arm64.dmg"],
  ["win32-x64", "x64-Setup.exe"],
]);

export function installerTarget(platform, arch) {
  const target = `${platform}-${arch}`;
  return suffixes.has(target) ? target : null;
}

export function desktopInstaller(target, version) {
  const suffix = suffixes.get(target);
  if (!suffix || typeof version !== "string" || !stableVersion.test(version))
    throw new Error("Invalid desktop installer target or version.");
  return {
    version,
    url: `${repository}/releases/download/v${version}/SolveMate-${version}-${suffix}`,
  };
}
