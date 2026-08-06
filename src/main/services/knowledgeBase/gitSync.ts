import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true
    });

    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
    });
  });
}

export async function ensureSparseRepoSync(params: {
  baseDir: string;
  repoUrl: string;
  branch: string;
}): Promise<string> {
  const { baseDir, repoUrl, branch } = params;
  const repoDir = join(baseDir, "msteams-docs");
  const gitDir = join(repoDir, ".git");

  await mkdir(baseDir, { recursive: true });

  const repoExists = await pathExists(gitDir);
  if (!repoExists) {
    await runGit([
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      "--branch",
      branch,
      repoUrl,
      repoDir
    ]);
    await runGit(["sparse-checkout", "set", "--cone", "msteams-platform"], repoDir);
    return repoDir;
  }

  await runGit(["remote", "set-url", "origin", repoUrl], repoDir);
  await runGit(["fetch", "--depth", "1", "origin", branch], repoDir);
  await runGit(["checkout", branch], repoDir);
  await runGit(["sparse-checkout", "set", "--cone", "msteams-platform"], repoDir);
  await runGit(["pull", "--ff-only", "origin", branch], repoDir);

  return repoDir;
}

