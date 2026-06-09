#!/usr/bin/env node
// 发版派发器的跨平台启动器。
//
// WHY 存在：package.json 的 "deploy*" 脚本若直接写 `bash scripts/release.sh`，
// 在 Windows 上 pnpm 经 cmd.exe 解析 `bash` 时，PATH 里 System32\bash.exe（WSL 启动器）
// 会先于 Git Bash 命中——于是脚本被丢进 WSL 跑，ssh/gh/pnpm 环境全错，命令直接报废。
// 本启动器在 win32 上显式定位 Git Bash 的 bash.exe（绕开 WSL），其它平台用 PATH 里的 bash。
//
// 用法：node scripts/release.mjs <子命令> [flag...]，参数原样转交 release.sh。

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const releaseSh = join(__dirname, "release.sh");

// 定位一个“真正的 Git Bash”可执行文件，显式避开 WSL 的 System32\bash.exe。
function locateGitBashOnWindows() {
  const candidates = [];

  // 1) 最可靠：从已安装的 git 反推。git --exec-path 形如
  //    C:/Apps/Git/mingw64/libexec/git-core，向上回到 Git 安装根再拼 bin/bash.exe。
  try {
    const execPath = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
    }).trim();
    if (execPath) {
      // mingw64/libexec/git-core -> 上溯 3 级到安装根
      const gitRoot = resolve(execPath, "..", "..", "..");
      candidates.push(join(gitRoot, "bin", "bash.exe"));
    }
  } catch {
    // git 不在 PATH——继续走固定路径兜底。
  }

  // 2) 标准安装位置兜底。
  const { ProgramFiles, "ProgramFiles(x86)": ProgramFilesX86, LOCALAPPDATA } =
    process.env;
  for (const base of [
    ProgramFiles && join(ProgramFiles, "Git"),
    ProgramFilesX86 && join(ProgramFilesX86, "Git"),
    LOCALAPPDATA && join(LOCALAPPDATA, "Programs", "Git"),
    "C:\\Apps\\Git",
    "C:\\Git",
  ]) {
    if (base) candidates.push(join(base, "bin", "bash.exe"));
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function resolveBash() {
  if (process.platform !== "win32") {
    // Linux/macOS：PATH 里的 bash 即为所需，无 WSL 歧义。
    return "bash";
  }
  const gitBash = locateGitBashOnWindows();
  if (!gitBash) {
    console.error(
      [
        "ERROR: 未找到 Git Bash（bash.exe）。",
        "本启动器刻意不使用 WSL 的 System32\\bash.exe（环境不匹配会让发版命令失效）。",
        "请安装 Git for Windows（https://git-scm.com/download/win），或设置 GIT_BASH 指向 bash.exe。",
      ].join("\n"),
    );
    process.exit(1);
  }
  return gitBash;
}

// 允许显式覆盖（高级用户/非标准安装）。
const bashExe = process.env.GIT_BASH || resolveBash();

const result = spawnSync(bashExe, [releaseSh, ...process.argv.slice(2)], {
  stdio: "inherit",
  // RELEASE_LAUNCHER 标记“已由本启动器定位过 bash”，让 release.sh 的 WSL 守卫知道环境可信。
  env: { ...process.env, RELEASE_LAUNCHER: "node" },
});

if (result.error) {
  console.error(`ERROR: 启动 bash 失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
