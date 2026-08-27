import { defineRailway, project, service, volume } from "railway/iac";

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
    start: "python -m scripts.production_start",
    healthcheck: "/health",
    healthcheckTimeout: 600,
    replicas: {
      ams: 1,
    },
    networking: {
      privateNetworkEndpoint: "attractive-blessing",
    },
    volumeMounts: {
      "/data": gameData,
    },
    // dockerfilePath from CaC: "Dockerfile"
    // builder from CaC: "DOCKERFILE"
  });

  return project("lucid-happiness", {
    resources: [web, gameData],
  });
});
