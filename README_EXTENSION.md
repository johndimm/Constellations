# Loading the Constellations Chrome Extension

Follow these steps to build and load the Constellations extension into your Chrome browser.

## 1. Build the Extension
Run the specific build command for the extension. This will compile all TypeScript files and bundle them into the `dist-extension/` directory.

```bash
npm run build:ext
```

## 2. Load into Chrome
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `dist-extension/` folder in your project directory: 
   `/Users/johndimm/projects/Constellations/dist-extension`

## 3. How to Use
- **Side Panel**: Click the Constellations icon in your toolbar to open the side panel. It will automatically search for the topic of your current tab.
- **Context Menu**: Highlight any text on a webpage, right-click, and select **Graph '...' on Constellations** to search for that specific term.
- **Standalone Hand-off**: Click the "External Link" icon in the extension's top bar to open your current graph in the full standalone application.
