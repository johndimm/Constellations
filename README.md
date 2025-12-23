<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1QsVlUXoJ8FHNE5oQ1jtwX6DrevdxoUz3

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Sharing static graphs

- Place exported graph JSON files in `public/graphs/` (e.g. `public/graphs/my_favorite_graph.json`).
- Open the app with `?graph=my_favorite_graph` to load that file automatically.
- Saved graphs from localStorage can be exported via the UI (Save → Export) and then copied into `public/graphs/`.
