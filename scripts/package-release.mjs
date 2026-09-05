import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginAssets = [
  "main.js",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "docs/START-HERE.md",
  "docs/PUBLISHING.md",
  "docs/VALIDATION.md"
];
const releaseAssets = ["main.js", "manifest.json", "styles.css"];
const companionSkills = [
  "ai-knowledge-project-onboarding",
  "ai-knowledge-task-management",
  "ai-knowledge-weekly-summary"
];
const skillExtensions = new Set([".md", ".py", ".yaml", ".yml"]);
const ignoredSkillNames = new Set(["__pycache__", ".DS_Store"]);

// 固定时间、权限和排序，避免文件系统时间戳影响发布包校验值。
const zipProgram = String.raw`
import pathlib
import stat
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
entries = [root, *root.rglob("*")]
entries.sort(key=lambda item: item.relative_to(root.parent).as_posix())
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for item in entries:
        if item.is_symlink():
            raise SystemExit(f"Refusing to package symlink: {item}")
        relative = item.relative_to(root.parent).as_posix()
        is_directory = item.is_dir()
        info = zipfile.ZipInfo(relative + ("/" if is_directory else ""), (1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        mode = (stat.S_IFDIR | 0o755) if is_directory else (stat.S_IFREG | (0o755 if item.suffix == ".py" else 0o644))
        info.external_attr = (mode << 16) | (0x10 if is_directory else 0)
        archive.writestr(info, b"" if is_directory else item.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(target) as archive:
    invalid = archive.testzip()
    if invalid is not None:
        raise SystemExit(f"Corrupt ZIP member: {invalid}")
`;

async function requireRegularFile(filePath) {
  const stat = await fs.lstat(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${filePath}`);
}

async function requireDirectory(directoryPath) {
  const stat = await fs.lstat(directoryPath);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `Expected a directory: ${directoryPath}`);
}

async function copyRegularFile(source, destination) {
  await requireRegularFile(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyPluginAssets(destination) {
  for (const file of pluginAssets) {
    await copyRegularFile(path.join(projectRoot, file), path.join(destination, file));
    if (file === "docs/START-HERE.md") {
      const copiedPath = path.join(destination, file);
      const content = await fs.readFile(copiedPath, "utf8");
      await fs.writeFile(copiedPath, content.replace("](.obsidian/plugins/ai-knowledge-workflow/README.md)", "](../README.md)"), "utf8");
    }
  }
}

async function copySkill(source, destination) {
  await requireDirectory(source);
  await fs.mkdir(destination, { recursive: true });
  const names = (await fs.readdir(source)).sort();
  for (const name of names) {
    if (ignoredSkillNames.has(name)) continue;
    assert(!name.startsWith("."), `Unexpected hidden skill content: ${path.join(source, name)}`);
    const sourcePath = path.join(source, name);
    const stat = await fs.lstat(sourcePath);
    assert(!stat.isSymbolicLink(), `Refusing to package symlink: ${sourcePath}`);
    if (stat.isDirectory()) {
      assert(name !== "node_modules", `Unexpected dependencies in skill: ${sourcePath}`);
      await copySkill(sourcePath, path.join(destination, name));
    } else {
      assert(skillExtensions.has(path.extname(name)), `Unapproved skill file type: ${sourcePath}`);
      await copyRegularFile(sourcePath, path.join(destination, name));
    }
  }
}

async function createStarter(workDirectory, starterDirectory, pluginId) {
  const initializerModule = path.join(workDirectory, "initializer.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src/vault/VaultInitializer.ts")],
    outfile: initializerModule,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    logLevel: "silent"
  });
  const { VaultInitializer } = await import(pathToFileURL(initializerModule).href);
  const resolveVaultPath = (relativePath) => {
    assert(!path.isAbsolute(relativePath), `Initializer path must be relative: ${relativePath}`);
    const absolutePath = path.resolve(starterDirectory, relativePath);
    assert(absolutePath === starterDirectory || absolutePath.startsWith(`${starterDirectory}${path.sep}`),
      `Initializer path escapes the starter: ${relativePath}`);
    return absolutePath;
  };
  const adapter = {
    async exists(relativePath) {
      try {
        await fs.stat(resolveVaultPath(relativePath));
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    async mkdir(relativePath) {
      await fs.mkdir(resolveVaultPath(relativePath));
    },
    async write(relativePath, content) {
      await fs.writeFile(resolveVaultPath(relativePath), content, "utf8");
    }
  };
  await fs.mkdir(starterDirectory);
  const created = await new VaultInitializer({ vault: { adapter } }).initialize();
  assert(created.createdFiles.length > 0, "VaultInitializer did not create any starter files.");

  await copyPluginAssets(path.join(starterDirectory, ".obsidian", "plugins", pluginId));
  for (const skill of companionSkills) {
    const source = path.join(projectRoot, "companion-skills", skill);
    await requireRegularFile(path.join(source, "SKILL.md"));
    await copySkill(source, path.join(starterDirectory, ".agents", "skills", skill));
  }
  await copyRegularFile(path.join(projectRoot, "docs", "START-HERE.md"), path.join(starterDirectory, "START-HERE.md"));
  return created;
}

function createZip(sourceDirectory, outputPath) {
  try {
    execFileSync("python3", ["-c", zipProgram, sourceDirectory, outputPath], { stdio: "pipe" });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`Packaging requires Python 3 with zipfile support. ${detail}`, { cause: error });
  }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, "package.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, "package-lock.json"), "utf8"));
  const versions = JSON.parse(await fs.readFile(path.join(projectRoot, "versions.json"), "utf8"));
  assert(manifest.id === "ai-knowledge-workflow", "Unexpected plugin ID in manifest.json.");
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "Obsidian requires an x.y.z plugin version.");
  assert(packageJson.version === manifest.version, "package.json and manifest.json versions must match.");
  assert(lock.version === manifest.version && lock.packages?.[""].version === manifest.version, "Lockfile version must match manifest.json.");
  assert(versions[manifest.version] === manifest.minAppVersion, "versions.json must include the current minimum Obsidian version.");
  for (const file of pluginAssets) await requireRegularFile(path.join(projectRoot, file));
  await requireRegularFile(path.join(projectRoot, "docs", "START-HERE.md"));
  const mainBundle = await fs.readFile(path.join(projectRoot, "main.js"), "utf8");
  assert(!mainBundle.includes("sourceMappingURL="), "main.js contains a source map; run the production build before packaging.");

  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ai-knowledge-release-"));
  let publishDirectory;
  try {
    const outputDirectory = path.join(workDirectory, "output");
    await fs.mkdir(outputDirectory);
    const pluginDirectory = path.join(workDirectory, manifest.id);
    await copyPluginAssets(pluginDirectory);
    const starterName = `ai-knowledge-starter-${manifest.version}`;
    const starterDirectory = path.join(workDirectory, starterName);
    const created = await createStarter(workDirectory, starterDirectory, manifest.id);
    const zipNames = [`${manifest.id}-${manifest.version}.zip`, `${starterName}.zip`];
    createZip(pluginDirectory, path.join(outputDirectory, zipNames[0]));
    createZip(starterDirectory, path.join(outputDirectory, zipNames[1]));
    for (const file of releaseAssets) {
      await copyRegularFile(path.join(projectRoot, file), path.join(outputDirectory, file));
    }
    const outputNames = [...zipNames, ...releaseAssets].sort();
    const sums = [];
    for (const name of outputNames) {
      const hash = createHash("sha256").update(await fs.readFile(path.join(outputDirectory, name))).digest("hex");
      sums.push(`${hash}  ${name}`);
    }
    await fs.writeFile(path.join(outputDirectory, "SHA256SUMS.txt"), `${sums.join("\n")}\n`, "utf8");
    outputNames.push("SHA256SUMS.txt");

    const distDirectory = path.join(projectRoot, "dist");
    await fs.mkdir(distDirectory, { recursive: true });
    publishDirectory = await fs.mkdtemp(path.join(distDirectory, ".package-"));
    for (const name of outputNames) {
      await copyRegularFile(path.join(outputDirectory, name), path.join(publishDirectory, name));
    }
    for (const name of outputNames) {
      await fs.rename(path.join(publishDirectory, name), path.join(distDirectory, name));
    }
    console.log(`Packaged ${manifest.id} ${manifest.version}:`);
    for (const name of outputNames) console.log(`  dist/${name}`);
    console.log(`Starter generated from VaultInitializer: ${created.createdFiles.length} files, ${created.createdFolders.length} folders.`);
  } finally {
    if (publishDirectory) await fs.rm(publishDirectory, { recursive: true, force: true });
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

await main();
