export interface Target {
  bunTarget: string;
  npmDir: string;
  binaryName: string;
}

export const TARGETS: Target[] = [
  { bunTarget: "bun-darwin-arm64", npmDir: "darwin-arm64", binaryName: "shire" },
  { bunTarget: "bun-darwin-x64", npmDir: "darwin-x64", binaryName: "shire" },
  { bunTarget: "bun-linux-x64", npmDir: "linux-x64", binaryName: "shire" },
  { bunTarget: "bun-linux-arm64", npmDir: "linux-arm64", binaryName: "shire" },
  { bunTarget: "bun-windows-x64", npmDir: "win32-x64", binaryName: "shire.exe" },
];

export function getTargetByBunTarget(bunTarget: string): Target | undefined {
  return TARGETS.find((t) => t.bunTarget === bunTarget);
}

export function getCurrentTarget(): Target | undefined {
  const key = `${process.platform}-${process.arch}`;
  return TARGETS.find((t) => t.npmDir === key);
}
