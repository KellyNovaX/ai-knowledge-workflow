import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "dist/**", "node_modules/**"] },
  ...obsidianmd.configs.recommended,
  {
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        brands: ["AI Knowledge", "AI Knowledge Workflow", "Codex", "OpenAI", "Obsidian", "WPS"],
        acronyms: ["AI", "API", "CLI", "CSS", "FAQ", "HTML", "ID", "JSON", "POSIX", "URL", "WPS", "YYYY-MM-DD"],
        allowAutoFix: true
      }]
    },
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.*"] }
      }
    }
  }
]);
