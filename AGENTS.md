# AGENTS.md

個人用的瀏覽器剪輯器,由 OpenCut classic 精簡而來:沒有網站與後端,Vite 靜態 SPA,部署在 GitHub Pages。
渲染引擎是 Rust(wgpu)編譯成 WASM。檔案與專案都留在使用者的瀏覽器(IndexedDB / OPFS)。

## 工作規則

- **只在 `slim` 分支工作,不要動 `main`。**
- 這個環境沒有 npm / bun 可以裝依賴,**驗證靠 GitHub Actions**:推到 `slim` 後,確認 `Slim CI`(型別檢查 + 打包 + 單元測試)與 `Deploy to GitHub Pages` 都通過才算完成。
  - 看結果:`gh run list --branch slim`
  - 完整日誌下載會被擋(403),但 **annotations 可以讀**:
    `gh api repos/ToruSmith/opencut-classic/check-runs/<job_id>/annotations --jq '.[] | "\(.title)\n\(.message)"'`
    失敗訊息(`.github/scripts/run-step.sh`)與 `bundle-report` / `bundle-chunk-N` 打包大小報告都在裡面。
  - Slim CI 的 `Unit tests` 步驟允許失敗(有幾個既有失敗,見下方「已知問題」),要看的是有沒有**新增**的失敗。
- 沒有 node_modules 時仍可用全域 `tsc` 粗略檢查:用 `types: []` 的暫時 tsconfig,和 `git stash` 前的基準錯誤清單做差異比對,只看新增的錯誤。
- 純函式(不依賴 DOM / wasm / 套件)的測試可以在本機用 `bun test <檔案>` 直接跑,例如 `apps/web/src/media/__tests__/audio-mixer.test.ts`。

## 架構

- `rust/crates/*`:所有與 UI 無關的邏輯(時間、遮罩、特效著色器、GPU 合成)。`rust/wasm` 把它們編成 `opencut-wasm`。
  **邏輯放在 Rust,不要在 TypeScript 裡重寫一份。**
- `apps/web`:UI 外殼(React 19 + Vite 6 + Tailwind 4 + zustand)。
  - `src/core/managers/*`:`EditorCore` 與各 manager(播放、時間軸、音訊預覽、渲染…)。
  - `src/services/renderer/*`:渲染樹 → 影格描述 → WASM 合成。`CanvasRenderer` 有 `quality: "preview" | "full"`。
  - `src/effects/definitions/`:濾鏡的前端定義;著色器在 `rust/crates/effects`。
  - `src/media/`:素材處理與音訊匯出(見下)。
  - `src/services/storage/`:IndexedDB / OPFS 與專案遷移(`migrations/`)。
- 路由是 `HashRouter`,頁面在 `src/app/`。沒有 Next.js;`next/*` 已全部移除。

## 慣例

- 介面字串是**繁體中文,直接寫在原始碼裡**,沒有 i18n 框架。
- 函式參數用單一物件(ESLint 規則 `prefer-object-params`);縮排用 tab。
- 先讀元件再用,它們常常已經套了 class(`components/ui/*`)。
- 站內圖片用 `@/components/ui/app-image`(會補 `BASE_URL`),站內導覽用 `@/hooks/use-router` 或 react-router 的 `Link`。

## 效能相關約定(改動前先看)

- **路由已 lazy load**(`main.tsx`),專案列表頁顯示後會在閒置時預取編輯器。
- **mediabunny 一律用 `await import("mediabunny")`**,型別用 `import type`。不要在會被專案列表引用到的檔案裡靜態 import 它(`@/core` 會把大部分 manager 一起拉進列表頁)。
- `vite.config.ts` 的 `manualVendorChunk` 把 react / mediabunny / icons / radix 獨立成穩定檔名,方便瀏覽器快取;新增體積大的第三方套件時考慮加進去。
- 建置會產生 `precache.json`;開啟離線模式時會依它預抓所有程式碼。新增「不該預抓」的大檔(像 onnx wasm)要在 `precacheManifest` 裡排除。
- 預覽用 `quality: "preview"`,影片以畫布大小解碼;匯出與快照用 `"full"`(原始解析度)。`videoCache` 對不同尺寸各用一個解碼器。
- 量預覽效能:在 devtools 執行 `window.__renderPerf = true`,每 60 格會輸出一次各階段耗時(`previewFrame`、`resolve`、`buildFrame`、`syncTextures`、`renderFrame`、`sceneRebuild`)與計數(`textureUploadPixels`、`previewBusyTick`…)。

## 音訊匯出(分段處理)

匯出時音訊不再一次混成整段 `AudioBuffer`:

- `media/audio-mixer.ts`:**純函式**,片段混音(與舊版整段演算法逐位元相同,有測試)與串流前視限幅器 `LookaheadLimiter`(天花板 0.98)。
- `media/audio-export.ts`:`createTimelineAudioStream()`,每次 `nextChunk()` 混 5 秒;只解碼該段需要的來源範圍;需要音高保持的變速片段會先轉成「片段長度」的緩衝(記憶體與該片段長度成正比)。
- `services/renderer/scene-exporter.ts`:音訊 chunk 與影片影格交錯寫入編碼器。
- `media/mediabunny.ts` 的 `extractTimelineAudio`(轉錄用)走同一條串流,輸出 16-bit WAV。
- 預覽的限幅(`media/audio-mastering.ts`)仍是 Web Audio 的 `DynamicsCompressorNode`,和匯出的限幅器不是同一個實作。

## 已知問題

- `bun test` 有既有失敗(與近期改動無關):`timeline/placement/__tests__/resolve.test.ts`(`ZERO_MEDIA_TIME` 初始化順序)、`params/registry.ts`(`DEFAULTS` 初始化順序)——都是循環匯入;以及 bun 載不了 `opencut-wasm`。
- 日誌下載被擋,只能讀 annotations。
- Rust release 使用 `lto` + `codegen-units=1`(Cargo.toml),CI 的 wasm 步驟會比以前慢一些。
