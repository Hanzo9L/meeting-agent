import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@main": resolve(__dirname, "src/main"),
        "@shared": resolve(__dirname, "src/shared")
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/main"
    }
  },
  preload: {
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared")
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        input: {
          helpdesk: resolve(__dirname, "src/preload/helpdeskPreload.ts"),
          overlay: resolve(__dirname, "src/preload/overlayPreload.ts")
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer"),
        "@shared": resolve(__dirname, "src/shared")
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          helpdesk: resolve(__dirname, "src/renderer/helpdesk/index.html"),
          overlay: resolve(__dirname, "src/renderer/overlay/index.html")
        }
      }
    }
  }
});
