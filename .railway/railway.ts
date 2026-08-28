import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

// Last resort for a per-service CaC repo. Prefer one .railway file for the
// project and drop this if you later combine services into that file.
export const partial = "web";

export default defineRailway(() => {
  const gameData = volume("game-data", {
    sizeMB: 5000,
    region: "ams",
    allowOnlineResize: true,
    alerts: {
      usage: {
        "80": {},
        "95": {},
        "100": {},
      },
    },
  });

  const web = service("web", {
    source: github("Mingyue-pro/ai-image-classifier-game", {
      branch: "feature/railway-deployment",
    }),
    start: "python -m scripts.production_start",
    healthcheck: "/health",
    healthcheckTimeout: 600,
    replicas: {
      ams: 1,
    },
    networking: {
      privateNetworkEndpoint: "attractive-blessing",
      serviceDomains: {
        "web-production-7c808.up.railway.app": {
          port: 8080,
        },
      },
    },
    volumeMounts: {
      "/data": gameData,
    },
    env: {
      AI_IMAGE_GAME_DATABASE_URL: preserve(),
      AI_IMAGE_GAME_FINAL_ASSET_BUNDLE: preserve(),
      AI_IMAGE_GAME_FINAL_ASSET_SHA256: preserve(),
      AI_IMAGE_GAME_PRELOAD_MODEL: preserve(),
      AI_IMAGE_GAME_RUNTIME_ROOT: preserve(),
      GAME_VERSION: preserve(),
      STUDY_PHASE: preserve(),
      TORCH_HOME: preserve(),
    },
    // dockerfilePath from CaC: "Dockerfile"
    // builder from CaC: "DOCKERFILE"
  });

  return project("lucid-happiness", {
    resources: [web, gameData],
  });
});
