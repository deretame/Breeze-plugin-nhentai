import type { InfoContract } from "breeze-plugin-kit";
import { PLUGIN_ID } from "./common";

export function buildPluginInfo(): InfoContract {
  return {
    name: "nhentai",
    uuid: PLUGIN_ID,
    iconUrl:
      "https://raw.githubusercontent.com/deretame/Breeze-plugin-nhentai/main/assets/Nhentai_idAD-FU-t__1.svg",
    creator: {
      name: "Breeze plugin",
      describe: "nhentai source adapter",
    },
    describe: "nhentai 漫画源插件",
    version: "0.0.4",
    updateUrl:
      "https://api.github.com/repos/deretame/Breeze-plugin-nhentai/releases/latest",
    home: "https://github.com/deretame/Breeze-plugin-nhentai",
    npmName: "breeze-plugin-nhentai",
    function: [
      {
        id: "latest",
        title: "最新",
        action: {
          type: "openComicList" as const,
          payload: {
            scene: {
              title: "nhentai",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList" as const,
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
        },
      },
      {
        id: "favorites",
        title: "收藏",
        action: {
          type: "openComicList" as const,
          payload: {
            scene: {
              title: "我的收藏",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList" as const,
                request: {
                  fnPath: "getFavoritesData",
                  core: {},
                  extern: {},
                },
              },
            },
          },
        },
      },
      {
        id: "popular",
        title: "热门",
        action: {
          type: "openComicList" as const,
          payload: {
            scene: {
              title: "今日热门",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList" as const,
                request: {
                  fnPath: "getPopularData",
                  core: {},
                  extern: {},
                },
              },
            },
          },
        },
      },
      {
        id: "random",
        title: "手气不错",
        action: {
          type: "openComicList" as const,
          payload: {
            scene: {
              title: "手气不错",
              source: PLUGIN_ID,
              body: {
                type: "pluginPagedComicList" as const,
                request: {
                  fnPath: "getRandomData",
                  core: {},
                  extern: {},
                },
              },
            },
          },
        },
      },
    ],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
