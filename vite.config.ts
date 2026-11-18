import { defineConfig } from 'vite';

// Relative asset paths so the build works from any folder (artifact host, GitHub Pages, etc.)
export default defineConfig({
  base: './',
});
