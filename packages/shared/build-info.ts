// Build-time version of the app, the same for API and web (shown in Settings).
// Release images get APP_VERSION and APP_COMMIT as Docker build args from the release workflow;
// any other build is "<package.json version>-dev" at the current git commit.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface BuildInfo {
  version: string;
  commit: string;
}

export function buildInfo(): BuildInfo {
  return {
    version: process.env.APP_VERSION || `${rootVersion()}-dev`,
    commit: process.env.APP_COMMIT || gitCommit(),
  };
}

function rootVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown"; // e.g. Docker builds: .git is not in the build context
  }
}
