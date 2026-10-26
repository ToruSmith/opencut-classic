# AGENTS.md

個人用的瀏覽器剪輯器,由 OpenCut classic 精簡而來:沒有網站與後端,Vite 靜態 SPA,部署在 GitHub Pages。
渲染引擎是 Rust(wgpu)編譯成 WASM。檔案與專案都留在使用者的瀏覽器(IndexedDB / OPFS)。

## 工作規則

- **只在 `slim` 分支工作,不要動 `main`。**
- 這個環境沒有 npm / bun 可以裝依賴,**驗證靠 GitHub Actions**。推到 `slim` 後只會觸發 `Deploy to GitHub Pages` 這一個 workflow,它裡面分三個 job:
  - `ci`(呼叫 `slim-ci.yml`:型別檢查、打包、單元測試、shader 驗證)與 `build`(編譯 WASM 並打包網站)同時進行;
  - `deploy` 要等 `ci` 與 `build` **都成功**才會發佈。CI 失敗 = 不會發佈。
  - 全部通過才算完成。發佈後請依 `docs/qa-checklist.md` 在真實瀏覽器驗收(CI 抓不到畫面、聲音、效能的問題)。
  - 看結果:`gh run list --branch slim`;要讀 annotations 得先用 `gh run view <run_id> --json jobs --jq '.jobs[]|"\(.name) \(.databaseId)"'` 找 job id(CI 的 job 名稱是 `ci / build`、`ci / shaders`)。
  - `slim-ci.yml` 也能手動觸發(`workflow_dispatch`),用來在不部署的情況下單獨跑 CI。
  - 完整日誌下載會被擋(403),但 **annotations 可以讀**:
    `gh api repos/ToruSmith/opencut-classic/check-runs/<job_id>/annotations --jq '.[] | "\(.title)\n\(.message)"'`
    失敗訊息(`.github/scripts/run-step.sh`)與 `bundle-report` / `bundle-chunk-N` 打包大小報告都在裡面。
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

- **單元測試有「棘輪」**:CI 的測試步驟(`.github/scripts/test-ratchet.sh`)會把失敗的測試與 `.github/known-failing-tests.txt` 比對——清單以外的新失敗會讓 CI 失敗(Deploy 不會發佈);已修好的會提醒你從清單刪掉。整個測試檔載入失敗(bun 只印 `Unhandled error`、沒有 `(fail)`)也算失敗。
- `apps/web/test-setup.ts`(由 `bunfig.toml` 預載)用真正的 WASM 初始化 `opencut-wasm`。bun 不支援 wasm-pack bundler 目標的 ESM 匯入 .wasm,沒有這一步,依賴 WASM 的 `const`(像 `ZERO_MEDIA_TIME`)會在模組載入到一半時丟錯。本機沒有 node_modules 時這個預載會失敗並印警告,測試仍會跑,只是依賴 WASM 的會失敗。
- 目前已知失敗 3 個(都在遮罩,原因寫在 `known-failing-tests.txt`),需要有人判斷是測試過時還是程式要改。
- 刪除素材後「復原」:素材檔在刪除當下就從 OPFS 移除,復原時用的是記憶體裡的 `File`。OPFS 的 `File` 在檔案被刪後可能無法再讀
  (Chrome 會丟 `NotReadableError`),所以復原可能救不回素材。尚未修(要改成延後刪除)。
- 日誌下載被擋,只能讀 annotations。
- Rust release 使用 `lto` + `codegen-units=1`(Cargo.toml),CI 的 wasm 步驟會比以前慢一些。

## 音訊淡入淡出、版本紀錄、代理檔(2026-10 新增)

- **音訊淡化**存在 `element.params.audioFadeIn` / `audioFadeOut`(秒),規則在 `timeline/audio-fade.ts`(純函式,有測試)。
  `resolveEffectiveAudioGain` 會乘上淡化係數,所以預覽、匯出、轉錄、波形都自動套用。
  判斷「增益會不會隨時間變」要用 `hasTimeVaryingGain`,不要只看 `hasAnimatedVolume`,否則淡化會被忽略。
  預覽的逐段播放路徑(`runClipIterator`)每一段各自排增益曲線;分割片段時左半留淡入、右半留淡出。
- **`previewElements` 的 `params` 是整包取代**,不是合併:拖曳類 UI 一定要 `{ ...element.params, key: value }`。
- **版本紀錄**:獨立的 IndexedDB `video-editor-snapshots`,規則在 `services/storage/snapshot-policy.ts`。
  只存專案 JSON、不存素材;還原前會先強制存一份目前狀態,還原後重跑儲存遷移。
- **備份時間**記在 localStorage `opencut-last-backup`(專案 id → ms)。
- **代理檔**:OPFS `media-proxies-<projectId>`,`media/proxy.ts` 用 mediabunny Conversion 產生
  (`trim.start = 0` 保持時間戳和原始檔一致、0.5 秒一個關鍵影格、不含音訊)。
  `MediaAsset.proxyFile` 只在預覽品質使用(`resolve.ts` 的 `pickVideoSource`,videoCache key 是 `<id>@proxy`),匯出與快照一律讀原始檔。
- **交叉溶解**:`transitions/cross-dissolve.ts`(純函式)找出重疊的前後兩段,上層片段做不透明度關鍵影格、聲音用上面的淡化參數;
  套用時用 `timeline.applyElementEdits` 合成一個復原步驟。同一條軌道的片段不能重疊,所以溶接一定是跨軌道。
- **LUT 尚未支援**:效果管線每個 pass 只綁一張輸入貼圖與 8 個浮點數的 uniform,要支援 .cube 需要在 `pipeline.rs` 加第二個貼圖綁定、
  在 bridge 傳 LUT 資料、並把 LUT 檔存進專案。

## 專案儲存、備份與重新連結(2026-10)

- **`IndexedDBAdapter.set` 一定是 key 優先**(`{ ...value, id: key }`)。舊版是 `{ id: key, ...value }`,
  匯入備份時備份裡的舊 `id` 蓋掉新 key,把匯入的專案寫到原專案上。`ensureMigrations` 之後會跑
  `repairMismatchedProjectIds`(規則在 `services/storage/project-repair.ts`)修復已經壞掉的紀錄。
- 從資料庫讀出的紀錄帶著 `id` 欄位,另存時一律先拿掉(`const { id: _id, ...rest } = record`)。
- **備份格式第 2 版**:`media[].included`;`false` 表示「只存專案」,匯入後素材只有 metadata、沒有 OPFS 檔案。
  `listMissingMedia` 找出這些素材,`relinkMedia` 依檔名 + 大小(其次唯一同名)對回去(`services/storage/relink.ts`)。
  第 1 版備份沒有 `included`,視為全部含素材。
- **找不到專案不再自動建立新專案**(以前每次都會多一個「未命名專案」),改顯示提示頁。
- **空白專案不保留**:離開編輯器(選單或瀏覽器上一頁)時,沒有任何片段、也沒有素材的專案會被刪掉(`project.discardIfEmpty`)。
  專案列表的「清除空白專案」用同一個判斷。

## 新增效果 / 轉場

- **效果(像素處理)**:
  1. 在 `rust/crates/effects/src/shaders/` 加 `.wgsl`(uniform 結構固定為 `resolution` + `direction`(vec2) + `scalars`(vec4),共 8 個浮點數)。
  2. 在 `pipeline.rs` 註冊 shader、並在 `pack_effect_uniforms` 加上該 shader 的 uniform 對應。
  3. 在 `shader_tests.rs` 的 `SHADERS` 加上新檔案。**CI 的 `shaders` job 用 naga 驗證所有 WGSL**——瀏覽器要到執行時才編譯 shader,只要有一個寫錯,所有效果會一起壞掉,CI 的 build / Deploy 都抓不到。
  4. 在 `apps/web/src/effects/definitions/` 加定義並在 `index.ts` 註冊。
  - 沒有 GPU 可以實測:shader 通過 naga 只代表語法與型別正確,視覺結果要在瀏覽器確認。
- **轉場(進出場動畫)**:`transitions/presets.ts` 是純函式,把動畫展開成關鍵影格(動畫基準值要從 `element.params` 讀,不是 `element.opacity` 這類不存在的欄位)。測試在 `transitions/__tests__/`。
- 字幕解析(`subtitles/`)、字幕切段(`transcription/caption.ts`)也都是純函式,有測試;中文沒有空格,按標點與字數(12 字)切。

## WASM 體積(已量測,2026-10)

- **Slim CI 的 bundle-report 裡的 WASM 是 npm 上已發佈的 `opencut-wasm`**(沒設 `OPENCUT_WASM_LOCAL`),不是我們自己編的。自己編的版本只有 Deploy 會用。
- 自己編的 `opencut_wasm_bg.wasm`,各種編譯設定的大小(gzip,GitHub Pages 提供的是 gzip):
  | 設定 | raw | gzip |
  |---|---|---|
  | 原始(無 LTO) | 2882 KB | 1066 KB |
  | **目前:LTO + codegen-units=1** | 2614 KB | **989 KB** |
  | + opt-level `s` | 2235 KB | 870 KB |
  | + opt-level `z` | 2011 KB | 792 KB |
  | + opt-level `s` 且移除 WebGL 後備 | 315 KB | 120 KB |
- 大宗來自 `gpu` crate 的 `wasm` feature 啟用的 `wgpu/webgl`(帶進 naga、wgpu-core、OpenGL 後端)。移除後只剩瀏覽器原生 WebGPU,體積降 88%,但**沒有 WebGPU 的瀏覽器會完全無法預覽與匯出**。
- 使用者看過這些數字後決定**維持現狀**(保留 WebGL、不調 opt-level)。除非使用者再提,不要主動改。
- 要重跑量測:修改 `.github/workflows/wasm-size.yml`(只有這個檔案被改的推送才會執行),結果在該 run 的 annotations(`wasm-size`)。
