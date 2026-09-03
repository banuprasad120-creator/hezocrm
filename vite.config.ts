import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { netlify } from "@netlify/vite-plugin-tanstack-start";

export default defineConfig({
  plugins: [
    netlify(),
    tanstackStart({
      server: { entry: "server" },
    }),
    tsconfigPaths(),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    host: true,
  },
});



