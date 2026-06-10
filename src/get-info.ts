import type { InfoContract } from "../types/type";
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
    version: "0.0.1",
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
    ],
  };
}

export function buildManifestInfo(): InfoContract {
  return buildPluginInfo();
}
