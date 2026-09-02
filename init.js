import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const githubToken = process.env.GITHUB_TOKEN;

if (!githubToken) {
  console.error("❌ 错误：未在 Shell 环境变量中找到 GITHUB_TOKEN");
  console.log('请先执行: $env:GITHUB_TOKEN = "your_token" (PowerShell)');
  process.exit(1);
}

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(rootDir, "src");
const outputFile = path.join(targetDir, "data.js");
const repoApi = "https://api.github.com/repos/EhTagTranslation/Database/releases/latest";

const requestOptions = {
  headers: {
    "User-Agent": "Breeze-Plugin-Init-Script",
    Authorization: `token ${githubToken}`,
  },
};

console.log("🚀 开始初始化标签翻译数据库...");

https
  .get(repoApi, requestOptions, (response) => {
    let body = "";

    if (response.statusCode !== 200) {
      console.error(
        `❌ API 请求失败 [${response.statusCode}]。请检查 Token 是否有效或是否超限。`,
      );
      return;
    }

    response.on("data", (chunk) => (body += chunk));
    response.on("end", () => {
      try {
        const release = JSON.parse(body);
        const asset = release.assets?.find((item) => item.name === "db.text.json");

        if (!asset?.browser_download_url) {
          console.error("❌ 错误：在最新 Release 中未找到 db.text.json");
          return;
        }

        console.log(`📦 发现新版本: ${release.tag_name}`);
        downloadFile(asset.browser_download_url);
      } catch (error) {
        console.error("❌ 解析 API 响应失败:", error instanceof Error ? error.message : error);
      }
    });
  })
  .on("error", (error) => console.error("❌ 网络连接错误:", error.message));

function downloadFile(url) {
  console.log("⏳ 正在下载数据库并转换为 ESM 格式...");

  https.get(url, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      https.get(response.headers.location, handleDownload);
      return;
    }
    handleDownload(response);
  });
}

function handleDownload(response) {
  let rawData = "";

  if (response.statusCode !== 200) {
    console.error(`❌ 下载失败，状态码: ${response.statusCode}`);
    return;
  }

  response.on("data", (chunk) => (rawData += chunk));
  response.on("end", () => {
    try {
      const parsed = JSON.parse(rawData);
      const trimmed = stripFields(parsed, new Set(["intro", "links"]));
      fs.mkdirSync(targetDir, { recursive: true });
      const finalContent = `export const data = ${JSON.stringify(trimmed, null, 2)};\n`;
      fs.writeFileSync(outputFile, finalContent, "utf8");
      console.log("\n✅ 处理完成！");
      console.log(`📍 文件位置: ${outputFile}`);
      console.log(`📊 数据大小: ${(finalContent.length / 1024 / 1024).toFixed(2)} MB`);
    } catch {
      console.error("❌ 转换失败：下载的文件内容不是有效的 JSON");
    }
  });
}

function stripFields(value, keysToRemove) {
  if (Array.isArray(value)) {
    return value.map((item) => stripFields(item, keysToRemove));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keysToRemove.has(key)) {
      result[key] = stripFields(child, keysToRemove);
    }
  }
  return result;
}
