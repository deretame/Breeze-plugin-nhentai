import { unzip } from "fflate";
import type {
  ActionItem,
  AdvancedSearchContract,
  ChapterContentContract,
  ChapterPage,
  ChapterPayload,
  ChapterSummary,
  ChapterWithPages,
  ComicDetailContract,
  ComicDetailNormal,
  ComicDetailPayload,
  ComicListItem,
  ComicListSceneBundleContract,
  ComicPagedListContract,
  CommentFeedContract,
  CommentFeedPayload,
  CommentItem,
  FetchImageBytesPayload,
  FilterBundleContract,
  InfoContract,
  MetadataListItem,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  RecommendItem,
  SearchComicPayload,
  SearchResultContract,
  SettingsBundleContract,
  StringMap,
} from "../types/type";
import {
  NOT_FOUND_IMAGE_URL,
  PLUGIN_ID,
  createActionItem,
  createImage,
  createMetadataActionList,
  toStringMap,
} from "./common";
import { buildPluginInfo } from "./get-info";
import { cache, pluginConfig, runtime } from "./tools";

const WEB_BASE = "https://nhentai.net";
const API_BASE = "https://nhentai.net/api/v2";
const IMAGE_BASE = "https://i3.nhentai.net";
const THUMB_BASE = "https://t3.nhentai.net";
const MAIN_CHAPTER_ID = "main";
const API_KEY_CONFIG_KEY = "apiKey";

type JsonRecord = Record<string, unknown>;

type NhentaiTitle = {
  english?: string;
  japanese?: string;
  pretty?: string;
};

type NhentaiTag = {
  id?: number | string;
  type?: string;
  name?: string;
};

type NhentaiPage = {
  number?: number;
  path?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
};

type NhentaiGallery = {
  id?: number | string;
  title?: string | NhentaiTitle;
  english_title?: string;
  japanese_title?: string;
  pretty_title?: string;
  tags?: NhentaiTag[];
  tag_ids?: Array<number | string>;
  pages?: NhentaiPage[];
  cover?: NhentaiPage;
  media_id?: string | number;
  related?: NhentaiGallery[];
  upload_date?: number | string;
  is_favorited?: boolean;
  num_favorites?: number | string;
  favorites?: number | string;
  num_pages?: number | string;
  page_count?: number | string;
  [key: string]: unknown;
};

type NhentaiSearchResponse = {
  result?: NhentaiGallery[];
  num_pages?: number | string;
  per_page?: number | string;
  total?: number | string;
};

type NhentaiCommentResponse = Array<{
  id?: number | string;
  poster?: { username?: string; avatar_url?: string };
  body?: string;
  post_date?: number | string;
}>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function stripLeadingSlash(path: string): string {
  return path.replace(/^\/+/, "");
}

function absolutize(base: string, path: unknown): string {
  const value = toText(path);
  if (!value) return NOT_FOUND_IMAGE_URL;
  if (/^https?:\/\//i.test(value)) return value;
  return `${base}/${stripLeadingSlash(value)}`;
}

function formatDate(value: unknown): string {
  const seconds = toNumber(value);
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function selectTitle(galleryOrTitle: unknown): string {
  if (typeof galleryOrTitle === "string") return galleryOrTitle.trim();
  const gallery = asRecord(galleryOrTitle);
  const record = asRecord(gallery.title || galleryOrTitle);
  return (
    toText(gallery.pretty_title) ||
    toText(gallery.japanese_title) ||
    toText(gallery.english_title) ||
    toText(record.pretty) ||
    toText(record.english) ||
    toText(record.japanese) ||
    "Untitled"
  );
}

function secondaryTitle(galleryOrTitle: unknown): string {
  const gallery = asRecord(galleryOrTitle);
  const record = asRecord(gallery.title || galleryOrTitle);
  return (
    toText(gallery.japanese_title) ||
    toText(gallery.english_title) ||
    toText(record.japanese) ||
    toText(record.english) ||
    ""
  );
}

function tagsByType(tags: NhentaiTag[], type: string): string[] {
  return tags
    .filter((tag) => tag.type === type)
    .map((tag) => toText(tag.name))
    .filter(Boolean);
}

function createSearchAction(type: string, value: string): ActionItem {
  return createActionItem(value, {
    type: "openSearch",
    payload: {
      source: PLUGIN_ID,
      keyword: `${type}:"${value.replace(/"/g, '\\"')}"`,
    },
  });
}

function normalizeLanguageFilters(extern: unknown): string[] {
  const raw = toStringMap(extern).languages;
  const selected = [toText(raw)].filter(Boolean).slice(0, 1);
  if (selected.includes("all") || selected.length === 0) return [];
  return Array.from(new Set(selected));
}

function buildSearchQuery(keyword: string, extern: unknown): string {
  const filters = normalizeLanguageFilters(extern);
  const base = keyword || "all";
  return [base, ...filters].join(" ").trim();
}

function buildSearchUrl(keyword: string, page: number, sort: string): string {
  const params = new URLSearchParams();
  params.set("query", keyword);
  params.set("page", String(page));
  params.set("sort", sort);
  return `${API_BASE}/search?${params.toString()}`;
}

async function fetchJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const apiKey = await loadApiKey({});
  const headers: Record<string, string> = {
    Accept: "application/json",
    Referer: `${WEB_BASE}/`,
    "User-Agent": "Breeze-plugin-nhentai/0.1.0",
  };
  if (apiKey) {
    headers.Authorization = `Key ${apiKey}`;
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`nhentai 请求失败: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function fetchGallery(comicId: string): Promise<NhentaiGallery> {
  const id = toText(comicId);
  if (!id) throw new Error("comicId 不能为空");
  return fetchJson<NhentaiGallery>(
    `${API_BASE}/galleries/${encodeURIComponent(id)}?include=related,favorite`,
  );
}

async function loadApiKey(extern: unknown): Promise<string> {
  const fromExtern = toText(toStringMap(extern).apiKey);
  if (fromExtern) return fromExtern;

  const raw = await pluginConfig.load(API_KEY_CONFIG_KEY, "");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { value?: unknown };
    const value = toText(parsed.value);
    if (value) return value;
  } catch {
    // 某些情况下可能直接返回原值
  }
  return "";
}

async function fetchDownloadUrl(
  comicId: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/galleries/${encodeURIComponent(comicId)}/download?format=zip`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Key ${apiKey}`,
        Referer: `${WEB_BASE}/`,
        "User-Agent": "Breeze-plugin-nhentai/0.1.0",
      },
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!res.ok) {
    throw new Error(`nhentai 下载请求失败: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { url?: string; expires_at?: number };
  const url = toText(data.url);
  if (!url) throw new Error("nhentai 未返回下载链接");
  return url;
}

async function fetchBinary(
  url: string,
  timeoutMs = 120000,
): Promise<Uint8Array> {
  const targetUrl = toText(url);
  if (!targetUrl) throw new Error("下载链接不能为空");
  const res = await fetch(targetUrl, {
    headers: {
      Referer: `${WEB_BASE}/`,
      "User-Agent": "Breeze-plugin-nhentai/0.1.0",
      "x-rquickjs-host-offload-binary-v1": "1",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`压缩包下载失败: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function unzipAsync(zip: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(zip, (err, data) => {
      if (err) reject(err);
      else resolve(data as Record<string, Uint8Array>);
    });
  });
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    !lower.endsWith("/") &&
    !lower.endsWith(".json") &&
    (lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".avif") ||
      lower.endsWith(".bmp"))
  );
}

function buildImageKey(comicId: string, imageName: string): string {
  return `${PLUGIN_ID}:${comicId}:${imageName}`;
}

async function storeZipImages(
  comicId: string,
  zipBytes: Uint8Array,
): Promise<ChapterPage[]> {
  const extracted = await unzipAsync(zipBytes);
  const entries = Object.entries(extracted)
    .filter(([name, data]) => isImageFile(name) && data.length > 0)
    .sort(([a], [b]) => naturalCompare(a, b));

  if (entries.length === 0) {
    throw new Error("压缩包中没有找到图片文件");
  }

  const pages: ChapterPage[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, data] = entries[i];
    const pageNo = i + 1;
    const imageKey = buildImageKey(comicId, name);
    const nativeId = await runtime.nativePut(data);
    await cache.set(imageKey, nativeId);
    pages.push({
      id: String(pageNo),
      name,
      path: name,
      url: "",
      extern: {
        comicId,
        imageName: name,
        imageKey,
      },
    });
  }
  return pages;
}

function mergeZipPagesWithGallery(
  zipPages: ChapterPage[],
  gallery: NhentaiGallery,
): ChapterPage[] {
  const galleryPages = asArray<NhentaiPage>(gallery.pages);
  return zipPages.map((page, index) => {
    const galleryPage = galleryPages[index];
    if (!galleryPage) return page;
    const path = toText(galleryPage.path);
    return {
      ...page,
      url: absolutize(IMAGE_BASE, path),
      extern: {
        ...page.extern,
        thumbnail: absolutize(THUMB_BASE, galleryPage.thumbnail),
        width: galleryPage.width ?? null,
        height: galleryPage.height ?? null,
      },
    };
  });
}

function galleryId(gallery: NhentaiGallery): string {
  return toText(gallery.id);
}

function galleryPageCount(gallery: NhentaiGallery): number {
  const pages = asArray<NhentaiPage>(gallery.pages);
  return pages.length || toNumber(gallery.num_pages ?? gallery.page_count);
}

function buildCover(gallery: NhentaiGallery): ReturnType<typeof createImage> {
  const id = galleryId(gallery);
  const cover = asRecord(gallery.cover);
  const path =
    toText(cover.thumbnail) ||
    toText(cover.path) ||
    toText(gallery.thumbnail) ||
    toText(gallery.cover_url);
  return createImage({
    id,
    url: absolutize(THUMB_BASE, path),
    name: `${id || "cover"}.jpg`,
    path: path || `gallery/${id}/cover.jpg`,
    extern: { path },
  });
}

function buildMetadata(gallery: NhentaiGallery): MetadataListItem[] {
  const tags = asArray<NhentaiTag>(gallery.tags);
  const metadata: MetadataListItem[] = [];
  const push = (type: string, name: string, values: unknown) => {
    const item = createMetadataActionList(type, name, values, (value) =>
      createSearchAction(type, value),
    );
    if (item.value.length > 0) metadata.push(item);
  };

  push("language", "语言", tagsByType(tags, "language"));
  push("artist", "作者", tagsByType(tags, "artist"));
  push("group", "社团", tagsByType(tags, "group"));
  push("parody", "原作", tagsByType(tags, "parody"));
  push("character", "角色", tagsByType(tags, "character"));
  push("category", "分类", tagsByType(tags, "category"));
  push("tag", "标签", tagsByType(tags, "tag"));
  return metadata;
}

function buildListItem(gallery: NhentaiGallery): ComicListItem {
  const id = galleryId(gallery);
  const title = selectTitle(gallery);
  const pageCount = galleryPageCount(gallery);
  const uploaded = formatDate(gallery.upload_date);
  const subtitleParts = [
    pageCount ? `${pageCount} pages` : "",
    uploaded,
  ].filter(Boolean);

  return {
    source: PLUGIN_ID,
    id,
    title,
    subtitle: subtitleParts.join(" / "),
    finished: true,
    likesCount: toNumber(gallery.num_favorites ?? gallery.favorites),
    viewsCount: 0,
    updatedAt: uploaded,
    cover: buildCover(gallery),
    metadata: buildMetadata(gallery),
    raw: gallery as StringMap,
    extern: { webUrl: `${WEB_BASE}/g/${id}/` },
  };
}

function buildRecommendItem(gallery: NhentaiGallery): RecommendItem {
  const item = buildListItem(gallery);
  const metadata: ActionItem[] = item.metadata
    .flatMap((meta) => meta.value)
    .slice(0, 6);
  return { ...item, metadata };
}

function buildChapterSummary(gallery: NhentaiGallery): ChapterSummary {
  const id = galleryId(gallery);
  return {
    id: MAIN_CHAPTER_ID,
    requestId: MAIN_CHAPTER_ID,
    logicalKey: MAIN_CHAPTER_ID,
    storageChapterId: id || MAIN_CHAPTER_ID,
    name: "本篇",
    order: 1,
    extern: {},
  };
}

function buildPages(gallery: NhentaiGallery): ChapterPage[] {
  return asArray<NhentaiPage>(gallery.pages).map((page, index) => {
    const path = toText(page.path);
    const pageNo = toNumber(page.number, index + 1);
    const name = path.split("/").pop() || `${pageNo}.jpg`;
    return {
      id: String(pageNo),
      name,
      path,
      url: absolutize(IMAGE_BASE, path),
      extern: {
        thumbnail: absolutize(THUMB_BASE, page.thumbnail),
        width: page.width ?? null,
        height: page.height ?? null,
      },
    };
  });
}

function buildChapterWithPages(gallery: NhentaiGallery): ChapterWithPages {
  return {
    ...buildChapterSummary(gallery),
    pages: buildPages(gallery),
  };
}

function buildNormalDetail(gallery: NhentaiGallery): ComicDetailNormal {
  const id = galleryId(gallery);
  const title = selectTitle(gallery);
  const japaneseTitle =
    toText(gallery.japanese_title) || secondaryTitle(gallery);
  const tags = asArray<NhentaiTag>(gallery.tags);
  const artists = tagsByType(tags, "artist");
  const pageCount = galleryPageCount(gallery);
  const uploaded = formatDate(gallery.upload_date);
  const titleMeta = [
    japaneseTitle && japaneseTitle !== title
      ? createActionItem(`Japanese: ${japaneseTitle}`)
      : null,
    id ? createActionItem(`ID: ${id}`) : null,
    gallery.media_id != null
      ? createActionItem(`Media ID: ${toText(gallery.media_id)}`)
      : null,
    pageCount ? createActionItem(`${pageCount} pages`) : null,
    uploaded ? createActionItem(uploaded) : null,
  ].filter(Boolean) as ActionItem[];

  return {
    comicInfo: {
      id,
      title,
      titleMeta,
      creator: {
        id: "",
        name: "",
        avatar: createImage({
          id: "",
          url: "",
          name: "",
          path: "",
          extern: {},
        }),
        onTap: {},
        extern: {},
      },
      description: secondaryTitle(gallery),
      cover: buildCover(gallery),
      metadata: buildMetadata(gallery),
      extern: { webUrl: `${WEB_BASE}/g/${id}/` },
    },
    eps: [buildChapterSummary(gallery)],
    recommend: asArray<NhentaiGallery>(gallery.related).map(buildRecommendItem),
    totalViews: 0,
    totalLikes: toNumber(gallery.num_favorites ?? gallery.favorites),
    totalComments: 0,
    isFavourite: Boolean(gallery.is_favorited),
    isLiked: false,
    allowComments: true,
    allowLike: false,
    allowCollected: false,
    allowDownload: true,
    extern: {},
  };
}

function currentSort(extern: unknown): string {
  const value = toText(toStringMap(extern).sortBy);
  const allowed = new Set([
    "date",
    "popular",
    "popular-today",
    "popular-week",
    "popular-month",
  ]);
  return allowed.has(value) ? value : "date";
}

async function getInfo(): Promise<InfoContract> {
  return buildPluginInfo();
}

async function searchComic(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  const page = Math.max(1, toNumber(payload.page, 1));
  const keyword = buildSearchQuery(toText(payload.keyword), payload.extern);
  const sort = currentSort(payload.extern);
  const data = await fetchJson<NhentaiSearchResponse>(
    buildSearchUrl(keyword, page, sort),
  );
  const pages = Math.max(1, toNumber(data.num_pages, 1));
  const total = toNumber(data.total, asArray(data.result).length);
  const items = asArray<NhentaiGallery>(data.result).map(buildListItem);
  const paging = {
    page,
    pages,
    total,
    hasReachedMax: page >= pages,
  };

  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "searchResult",
      source: PLUGIN_ID,
      list: "comicGrid",
    },
    data: { paging, items },
    paging,
    items,
  };
}

async function getComicDetail(
  payload: ComicDetailPayload = {},
): Promise<ComicDetailContract> {
  const comicId = toText(payload.comicId);
  const gallery = await fetchGallery(comicId);
  return {
    source: PLUGIN_ID,
    comicId,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "comicDetail",
      source: PLUGIN_ID,
    },
    data: {
      normal: buildNormalDetail(gallery),
      raw: gallery,
    },
  };
}

async function getReadSnapshot(
  payload: ReadSnapshotPayload = {},
): Promise<ReadSnapshotContract> {
  const comicId = toText(payload.comicId);
  const gallery = await fetchGallery(comicId);
  const chapter = buildChapterWithPages(gallery);
  const summary = buildChapterSummary(gallery);
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: {
        id: galleryId(gallery),
        source: PLUGIN_ID,
        title: selectTitle(gallery),
        extern: { webUrl: `${WEB_BASE}/g/${galleryId(gallery)}/` },
      },
      chapter,
      chapters: [
        {
          id: summary.id,
          name: summary.name,
          order: summary.order,
          extern: summary.extern,
        },
      ],
    },
  };
}

async function getChapter(
  payload: ChapterPayload = {},
): Promise<ChapterContentContract> {
  const comicId = toText(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");

  const apiKey = await loadApiKey(payload.extern);
  if (!apiKey) throw new Error("请设置api key");

  const downloadUrl = await fetchDownloadUrl(comicId, apiKey);
  const zipBytes = await fetchBinary(downloadUrl);
  const zipPages = await storeZipImages(comicId, zipBytes);

  const gallery = await fetchGallery(comicId);
  const chapterSummary = buildChapterSummary(gallery);
  const pages = mergeZipPagesWithGallery(zipPages, gallery);
  const chapter: ChapterWithPages = { ...chapterSummary, pages };

  return {
    source: PLUGIN_ID,
    comicId,
    chapterId: MAIN_CHAPTER_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "chapterContent",
      source: PLUGIN_ID,
    },
    data: {
      comic: {
        id: galleryId(gallery),
        source: PLUGIN_ID,
        title: selectTitle(gallery),
        extern: { webUrl: `${WEB_BASE}/g/${galleryId(gallery)}/` },
      },
      chapter,
      chapters: [chapterSummary],
    },
  };
}

async function fetchImageBytes(
  payload: FetchImageBytesPayload = {},
): Promise<Uint8Array<ArrayBufferLike>> {
  const targetUrl = toText(payload.url);
  const imageKey = toText(toStringMap(payload.extern).imageKey);

  if (imageKey) {
    try {
      const nativeId = await cache.get<number | null>(imageKey, null);
      if (nativeId != null) {
        return await runtime.nativeTake(nativeId);
      }
    } catch {
      // nativeTake 失败或缓存未命中，继续回退到 URL 下载
    }
  }

  if (!targetUrl) throw new Error("url 不能为空");
  const res = await fetch(targetUrl, {
    headers: {
      Referer: `${WEB_BASE}/`,
      "User-Agent": "Breeze-plugin-nhentai/0.1.0",
      "x-rquickjs-host-offload-binary-v1": "1",
    },
    signal: AbortSignal.timeout(payload.timeoutMs || 30000),
  });
  if (!res.ok) {
    throw new Error(`图片请求失败: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function getAdvancedSearchScheme(): Promise<AdvancedSearchContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "advancedSearch",
      title: "高级搜索",
      fields: [
        {
          key: "sortBy",
          kind: "choice",
          label: "排序",
          options: [
            { label: "最新", value: "date" },
            { label: "最热", value: "popular" },
            { label: "今日热门", value: "popular-today" },
            { label: "本周热门", value: "popular-week" },
            { label: "本月热门", value: "popular-month" },
          ],
        },
        {
          key: "languages",
          kind: "choice",
          label: "语言",
          options: [
            { label: "所有", value: "all" },
            { label: "仅中文", value: "chinese" },
            { label: "仅日文", value: "japanese" },
            { label: "仅英文", value: "english" },
          ],
        },
      ],
    },
    data: { values: { sortBy: "date", languages: "all" } },
  };
}

async function getComicListSceneBundle(): Promise<ComicListSceneBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "comicListSceneBundle",
    },
    data: {
      scene: {
        title: "nhentai",
        source: PLUGIN_ID,
        body: {
          type: "pluginPagedComicList",
          request: {
            fnPath: "getRankingData",
            core: {},
            extern: { sortBy: "date" },
          },
        },
        filter: {
          fnPath: "getRankingFilterBundle",
          extern: {},
        },
      },
    },
  };
}

async function getRankingData(
  payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  const result = await searchComic(payload);
  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "comicPagedList",
      source: PLUGIN_ID,
    },
    data: {
      items: result.items,
      hasReachedMax: result.paging.hasReachedMax,
    },
  };
}

async function getRankingFilterBundle(): Promise<FilterBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      title: "排序",
      fields: [
        {
          key: "sortBy",
          kind: "choice",
          label: "排序",
          options: [
            {
              label: "最新",
              value: "date",
              result: { extern: { sortBy: "date" } },
            },
            {
              label: "最热",
              value: "popular",
              result: { extern: { sortBy: "popular" } },
            },
            {
              label: "今日热门",
              value: "popular-today",
              result: { extern: { sortBy: "popular-today" } },
            },
            {
              label: "本周热门",
              value: "popular-week",
              result: { extern: { sortBy: "popular-week" } },
            },
            {
              label: "本月热门",
              value: "popular-month",
              result: { extern: { sortBy: "popular-month" } },
            },
          ],
        },
      ],
    },
    data: { values: { sortBy: "date" } },
  };
}

async function getCommentFeed(
  payload: CommentFeedPayload = {},
): Promise<CommentFeedContract> {
  const comicId = toText(payload.comicId);
  if (!comicId) throw new Error("comicId 不能为空");
  const data = await fetchJson<NhentaiCommentResponse>(
    `${API_BASE}/galleries/${encodeURIComponent(comicId)}/comments`,
  );
  const items: CommentItem[] = data.map((comment, index) => {
    const author = asRecord(comment.poster);
    const avatarUrl = toText(author.avatar_url);
    return {
      id: toText(comment.id) || `comment-${index + 1}`,
      author: {
        name: toText(author.username) || "anonymous",
        avatar: {
          url: avatarUrl || NOT_FOUND_IMAGE_URL,
          path: avatarUrl,
        },
      },
      content: toText(comment.body),
      createdAt: formatDate(comment.post_date),
      replyCount: 0,
      replies: [],
      extern: {},
    };
  });

  return {
    source: PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: { version: "1.0.0", type: "commentFeed" },
    data: {
      topItems: [],
      items,
      paging: { hasReachedMax: true },
      replyMode: "embedded",
      canComment: { comic: false, reply: false },
    },
  };
}

async function getSettingsBundle(): Promise<SettingsBundleContract> {
  const apiKey = await loadApiKey({});
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          id: "account",
          title: "账户",
          fields: [
            {
              key: API_KEY_CONFIG_KEY,
              kind: "text",
              label: "nhentai API Key",
              persist: true,
            },
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      values: {
        [API_KEY_CONFIG_KEY]: apiKey,
      },
    },
  };
}

export default {
  getInfo,
  searchComic,
  getComicDetail,
  getReadSnapshot,
  getChapter,
  fetchImageBytes,
  getAdvancedSearchScheme,
  getComicListSceneBundle,
  getRankingData,
  getRankingFilterBundle,
  getCommentFeed,
  getSettingsBundle,
};
