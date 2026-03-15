import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ command }) => {
  const isDev = command !== "build";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname),
      },
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      include: ["react", "react-dom"],
    },
    build: {
      outDir: "../priv/static/assets",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          app: "./js/app.js",
        },
        output: {
          entryFileNames: "js/[name].js",
          chunkFileNames: "js/[name]-[hash].js",
          assetFileNames: "css/[name][extname]",
        },
      },
      assetsInlineLimit: 0,
    },
    css: {
      devSourcemap: true,
    },
    server: {
      origin: "http://localhost:5173",
      cors: true,
    },
  };
});
