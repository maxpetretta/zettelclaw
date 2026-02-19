import { homedir } from "node:os";
import { resolve } from "node:path";

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return homedir();
  }

  if (inputPath.startsWith("~/")) {
    return resolve(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function resolveUserPath(inputPath: string): string {
  return resolve(expandHome(inputPath));
}
