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

## 功能地圖(接手先看這裡)

2026-10 這一輪加的功能,各自的細節在下面對應章節;**每個功能的實機驗收步驟都在 `docs/qa-checklist.md`(表格最右欄是章節編號)**(CI 看不到畫面、聲音、效能)。

| 功能 | 純函式 / 核心 | 入口 | 檢查清單 |
|---|---|---|---|
| 效果:馬賽克 / 色差 / 色調分離 / 底片顆粒 / 震動 / 放射模糊 / 故障 / 鏡像 | `rust/crates/effects/src/shaders/*.wgsl`、`effects/definitions/{stylize,motion}.ts` | 特效面板 | 3.9、3.11 |
| LUT(.cube + 內建風格) | `lut/{cube,store,presets}.ts` | 效果「LUT」 | 3.10、3.11 |
| 效果組合(衝擊、復古膠卷…) | `effects/presets.ts`、`timeline.insertElements` | 特效面板上方 | 3.13 |
| 進出場動畫、隨機轉場 | `transitions/presets.ts` | 轉場面板 | 3.16 |
| 交叉溶解、推移 / 滑動擦除 / 縮放 | `transitions/{cross-dissolve,pair-transition}.ts` | 轉場面板「兩段之間」 | 3.14 |
| 進度式擦除轉場(線性 / 光圈 / 時鐘 / 百葉窗 / 棋盤 / 菱形 / 噪點溶解 / 方塊崩落 / 對開) | `wipe.wgsl`、`effects/definitions/wipe.ts`、`transitions/wipe-transition.ts`、`ApplyWipeCommand` | 轉場面板「兩段之間的擦除」、特效「擦除」 | 3.18 |
| 節拍標記、依節拍分割、重排、一鍵快剪 | `media/beat-detect.ts`、`timeline/{reorder,bookmarks/beat-markers}.ts`、`QuickCutCommand` | 時間軸工具列音符按鈕 | 3.15 |
| 自動排片(依節拍從素材庫抽片段排滿整首歌) | `timeline/auto-cut.ts`、`AutoCutCommand` | 節拍面板「自動排片」 | 3.19 |
| PV 畫面效果:網點 / 雙色調 / VHS / 集中線 / 波浪扭曲 / 漏光 / 魚眼 | `effects/definitions/pv.ts`、`halftone` `duotone` `vhs` `speed_lines` `wave` `light_leak` `fisheye` `.wgsl` | 特效面板 | 3.23 |
| 變速曲線(階梯式:漸快 / 漸慢 / 子彈時間 / 中間衝刺) | `retime/speed-ramp.ts`、`SpeedRampCommand` | 屬性面板「速度」分頁 | 3.24 |
| 切點轉場(閃白 / 縮放衝入 / 甩鏡 / 旋轉甩入 / 故障切 / 震動切 / 隨機,不需重疊) | `transitions/cut-transition.ts`、`CutTransitionCommand`、`cut_motion.wgsl`、特效的 `skipWhen` | 轉場面板最上方「切點轉場」 | 3.22 |
| 範圍匯出(只輸出時間軸上的一段) | `export/range.ts`、`createTimelineAudioStream({ startTime })`、`SceneExporter` 的 `range` | 匯出視窗「範圍」 | 3.20 |
| 卡拉 OK 填色(選取字幕,高亮色由左向右蓋過底色) | `subtitles/karaoke.ts`、`KaraokeCommand`、`wipe.wgsl` 線性範圍 | 字幕面板「卡拉 OK 填色」 | 3.21 |
| 音訊淡入淡出、版本紀錄、代理檔、備份 / 重新連結 | 見各章節 | 屬性面板 / 素材庫 / 專案選單 | 3.6 ~ 3.8、3.12 |
| 匯出字幕 SRT / LRC(和 kinetic-lyric-console 搭配) | `subtitles/serialize.ts` | 字幕面板「匯出字幕」 | 4.2 |
| LRC 歌詞匯入、點拍同步歌詞 | `subtitles/{lrc,timed-lines}.ts`、`subtitles/components/lyrics-tap.tsx` | 字幕面板「匯入」/「點拍同步歌詞」 | 4.1 |
| 左側面板細捲軸 | `PanelView`(`base-panel.tsx`) | 所有左側面板 | 3.17 |

**實機驗收紀錄**:2026-10-28 使用者回報擦除新形狀(3.18)、切點轉場(3.22)、匯出字幕(4.2)「測試皆順利」。

### 尚未做 / 可以接著做(都是使用者看過、評估過的)

- **自動排片的第二版(使用者 2026-10-27 試用後評價「有點雞肋」:畫面和拍子關係不大,先擱置,等他再提才做)**:現在是最小版本(隨機抽、不連續重複、不做智慧選片、不變速)。可以接著做:素材比切段短時變速補長、依素材亮度 / 運動量選片、保留使用者鎖定的片段。

- **擦除的進階版**:現在的擦除是 shader 特效(進度可做關鍵影格),遮罩參數仍不能做關鍵影格;若要「形狀遮罩」式擦除才需要讓遮罩可動畫(動到專案格式,要寫遷移)。
  擦除目前只處理畫面,聲音的交叉淡化要另外用「交叉溶解」或音訊淡化。
- **節拍面板拆成「分析」與「剪輯」兩個分頁**:現在內容很長(已加捲動),使用者可能會想拆。
- **節拍偵測在真實音樂上的準確度還沒驗證**(只用合成節拍測過):節奏不穩 / 變速 / 純人聲的歌可能不準;若使用者回報偏差,從 `beat-detect.ts` 的門檻與 BPM 先驗(偏好 120)下手。
- 沒有刪除 LUT 的介面(沒用到的也留在專案裡,約 140 KB/個)。
- 已知失敗的 3 個遮罩測試(見「已知問題」)還沒人判斷是測試過時還是程式要改。

### 給接手者的提醒(踩過的坑)

- **看不到畫面**:這個環境沒有 GPU,無法實際跑編輯器的渲染。shader 通過 naga、測試通過,都**不代表畫面對**;每次都請使用者依檢查清單實機確認,不要宣稱「效果正常」。
- **一個壞掉的 shader 會讓所有效果一起壞**(瀏覽器到執行時才編譯)。改 `.wgsl` 一定要靠 CI 的 `shaders` job。
- **OPFS 的 `File` 會失效**(刪除或改寫後):要用就重新 `getFile()`(見「已知問題」)。
- **`UpdateElementsCommand` 逐筆套用**,主軌「最早片段貼齊 0」的規則會在中途狀態誤判;要一次改一批 `startTime` 請用 `ReorderElementsCommand` 的做法。
- **`previewElements` 的 `params` 是整包取代**,不是合併。
- **組合多個指令成單一復原步驟**有兩種做法:`BatchCommand`(子指令本身要能獨立執行,例如 `insertElements`、`splitElementsAtTimes`),
  或像 `QuickCutCommand` 直接呼叫子指令的 `execute()` 並自己 `undo`(子指令之間有「後一個要用前一個產生的 id」的依賴時用這個)。
- 預覽吃力時先建議使用者對素材**建立代理檔**,再去看渲染效能(`window.__renderPerf = true`)。
- 沒有 node_modules 時,依賴 `opencut-wasm` 的測試在本機會失敗;**純函式的測試**(不 import 到 `@/wasm` 的)才能在本機直接跑。新增邏輯時盡量寫成純函式,測試才有地方跑。
- 提交訊息用繁體中文,結尾要帶 `Co-Authored-By` 與 `Claude-Session` 兩行(見 git log 範例)。

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
- ~~刪除素材後「復原」救不回素材~~(已修):OPFS 的 `File` 在檔案被刪**或被改寫**後就失效(Chromium 實測:刪除 → `NotFoundError`,
  改寫 → `NotReadableError`;只有重新 `getFile()` 的新 `File` 能讀)。現在可以復原的刪除只移除素材記錄、檔案先留著
  (`deleteMediaAsset({ keepFile: true })`),復原 / 重做用 `restoreMediaAsset`:檔案還在就只補回記錄並**重新讀一份新的 File**
  (`swapRestoredAsset` 換進記憶體),不要在檔案還在時再寫一次檔案。留下的孤兒檔案在下次 `loadProject` 時由
  `purgeOrphanMediaFiles` 清掉(規則在 `media-orphans.ts`:完全沒有素材記錄時不清,避免誤刪)。
  代價:刪掉的大檔案要到下次開啟專案才會釋放空間。
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
- **兩段之間的轉場**(`transitions/pair-transition.ts`,純函式,有測試):推移、滑動擦除、縮放。沿用交叉溶解的做法(後一段放在另一條軌道、和前一段重疊),
  配對邏輯在 `cross-dissolve.ts` 的 `findTransitionPair`。全用關鍵影格(位置 / 縮放 / 不透明度)+ 音訊淡化,以 `applyElementEdits` 合成一個復原步驟。
  **遮罩參數不能做關鍵影格**(`animation/` 只認片段屬性、特效參數、圖形參數),所以沒有「遮罩掃過」式的擦除;
  「滑動擦除」是上層片段滑進來蓋住(覆蓋)或滑出去露出下面(揭開)。真正的擦除見下一條「進度式擦除」。
- **進度式擦除**(線性 / 圓形光圈 / 時鐘 / 百葉窗 / 棋盤 / 菱形 / 噪點溶解 / 方塊崩落 / 對開):走「帶進度參數的 shader 特效」那條路,不動專案格式。
  `wipe.wgsl` 把圖層 alpha 乘上遮罩(premultiplied,整個 rgba 相乘):scalars = (模式, 進度, 柔邊, 角度);**模式編號 = `WIPE_KINDS` 的順序(只能往後加),加 16 = 反向**(以前是加 3,專案存的是模式名稱,所以不影響舊專案)。
  direction 依模式有三種用途:線性 = 掃過範圍、光圈 / 時鐘 / 菱形 = 中心、百葉窗 / 棋盤 / 溶解 / 方塊 = (數量, 種子)。
  每個模式只是「這個像素在進度多少時被擦掉」的不同算法(`sweep_position`),一個 pass、沒有額外貼圖;噪點溶解是兩層 value noise,種子先 `fract` 成小偏移(直接乘大數會讓雜湊失去精度)。
  進度 0 = 沒擦、1 = 全透明(邊緣位置 `progress * (1 + softness)`,兩端剛好完全沒擦 / 擦完)。`definitions/wipe.ts` 的 `buildPasses` 在**進度為 0 時回傳空陣列**,
  所以特效留在片段上、轉場以外的時間不會多跑一個全畫面 pass。空的 effectPassGroups 在合成器裡直接略過(`apply_effect_groups` 的 `group.is_empty()`),
  每個圖層本來就會先畫進一張畫面大小的貼圖,所以沒有額外的圖層開銷(2026-10-28 讀程式確認,不是實測)。
  套用(`wipe-transition.ts` 純函式 + `ApplyWipeCommand`):只對重疊時**在上層**的那一段加特效並對 `effects.<id>.params.progress` 做關鍵影格
  (上層是前一段:0 → 100;是後一段:100 → 0 且反向旗標取反,讓前進方向一致)。特效 id 要執行後才知道,所以 `ApplyWipeCommand` 像 `QuickCutCommand` 直接呼叫子指令的 `execute()`、undo 反向還原,一個復原步驟。
  再按一次會再疊一個擦除特效(可在特效屬性刪掉舊的)。
- **自動排片**(`timeline/auto-cut.ts` 的 `planAutoCut`,純函式,有測試):切點 = `pickSplitTimes`(每 2 / 4 / 8 拍、最短片段),上限 `DEFAULT_MAX_CUTS`(150,超過就隔幾個取一個並回報);
  每段用固定種子的亂數從素材池抽一支(不連續同一支,只有一支才重複),影片的入點隨機、出點不超過素材長度(trimStart + 長度 + trimEnd = 素材長度),
  太短的素材不會被抽中,全部都太短時用最長那支並縮短(畫面留空隙,回報 `shortfallCount`);圖片任意長度、入點 0。
  `AutoCutCommand`:新增一條影片軌(`AddTrackCommand`,index 0)後**只更新一次時間軸狀態**放入全部片段(不是每個片段一個 `InsertElementCommand`,避免 N 次場景重建),
  影片 `isSourceAudioEnabled: false`(靜音);`replaceTrackId` 讓「再按一次」取代上次的結果而不是越疊越多;一個復原步驟。
  排滿的範圍 = 音訊軌最後一個片段的結尾;介面在節拍面板,素材清單是素材庫裡的影片 / 圖片(可勾選),沒建立代理檔的影片會提示。
- **範圍匯出**(`export/range.ts` 的 `resolveExportRange`,純函式,有測試):起迄(秒)對齊到影格邊界(`startFrame` / `frameCount`,終點夾在最後一格),
  影片與音訊都用對齊後的同一組 tick,所以長度一致。`SceneExporter` 的 `range` 只渲染範圍內的格數(渲染用時間軸時間,寫進檔案的時間戳從 0 起算);
  音訊走 `createTimelineAudioStream({ startTime, duration })`,**只混 [startTime, duration)**,游標從起點開始,不是整段混完再裁。
  檔名後綴 `formatRangeFileSuffix`(`_00-12_00-45`)。綠幕 / 黑底合成沒有做(要動合成器)。取消匯出沿用既有機制。
- **卡拉 OK 填色**(`subtitles/karaoke.ts`,純函式,有測試;`KaraokeCommand`):對選取的文字片段,各在上方新增一條文字軌放「高亮色複本」,複本掛擦除特效並對 `progress` 做 100 → 0 的關鍵影格。
  `measureTextElement` 量出的 `visualRect` 是相對文字原點,實際位置 = 畫布中心 + `position` + `scale * rect`(`computeTextSpanFraction`),轉成 0..1 的左右邊界。
  擦除線性模式的 `rangeStart` / `rangeEnd`(%)重新映射掃過位置,**借用 direction 的兩個槽位**(`u_center_x/y`),Rust 端沒改;光圈 / 時鐘仍用 `centerX/Y`。舊專案沒有這兩個參數時預設 0 / 100。
  限制:均勻速度、多行整塊由左向右、旋轉文字退回整個畫面寬度。像 `AutoCutCommand` 一樣只更新一次時間軸狀態,一個復原步驟。
- **切點轉場**(`transitions/cut-transition.ts`,純函式,有測試;`CutTransitionCommand`):剪映「熱門轉場」那一類,**不需要重疊軌道**。
  對同一條軌道首尾相接的片段(`findCutPoints`,誤差 1/60 秒),前一段最後 h 秒把效果拉到峰值、後一段前 h 秒從峰值降回(緩入 / 緩出用 4 個關鍵影格近似,不靠 bezier)。
  全部是「片段上的特效 + 特效參數關鍵影格」:閃白 = 色彩調整的亮度;縮放 / 旋轉 / 甩鏡 = 新特效「轉場運動」`cut-motion`(平移、縮放、旋轉、方向模糊,畫面外鏡像延伸不露黑邊)
  加放射模糊;故障切 = 故障 + 色差;震動切 = 畫面震動 + 輕推。**不動片段自己的位置 / 縮放關鍵影格**,所以能乾淨地取代:
  特效 id 以 `cut-out-` / `cut-in-` 開頭,再套一次時 `stripCutEffects` 先拿掉同一端的舊特效與它們的關鍵影格(一個片段開頭和結尾可以各有一組)。
  全部算完才更新一次時間軸狀態(像 `KaraokeCommand`),單一復原步驟;「每個切點隨機」用 `pickCutKinds`(同種子可重現、相鄰不重複)。
  **效能**:特效留在片段上整段都在,轉場以外的時間參數是中性值 → `EffectRendererConfig.skipWhen` / `buildPasses` 回傳空,不跑 pass。
  `skipWhen` 加在放射模糊(強度 0)、故障(強度 0)、色差(位移 0)、震動(幅度與旋轉都 0)、所有色彩類(換算後等於中性值)。**只在 shader 對那組參數確實是原圖照抄時才加 `skipWhen`。**
  轉場中最貴的是放射模糊(32 點)和方向模糊(依長度,上限 32 點),只在切點前後 0.2~0.7 秒。
- **隨機轉場**(`transitions/presets.ts` 的 `pickRandomMotions`,純函式,有測試):對選取的多個片段(依開始時間排序)各抽一種進場 / 出場動畫
  (滑入 ×4、縮放、旋轉、彈出;**不含單純淡化**,否則切點處會一格一格閃黑),相鄰不重複、同種子可重現。
  不需要重疊軌道,直接用單一片段的進出場關鍵影格,所以可以套在快剪切出來的小段上;長度仍受「不超過片段一半」限制。
- **節拍標記**(剪 AMV 用):`media/beat-detect.ts`(純函式,有測試)把音訊每 512 取樣算一塊高頻能量(相鄰取樣差,對鼓點敏感)→ 對數上升量 →
  「重音」模式挑局部峰值(靈敏度 = 門檻倍率,最短間隔 0.15 秒)、「節拍格」模式用自相關估計 BPM(偏好 120 附近,避免半速 / 倍速),
  再在 ±3% 內微調速度與相位讓格線貼合整首歌。`media/beat-analysis.ts` 走 `createTimelineAudioStream`(22050 Hz、分段、動態載入),
  所以分析的是**時間軸混音後**的聲音,時間直接對應時間軸。結果寫成場景書籤(`note: "節拍"`、橘色),書籤本來就會被時間軸吸附;
  `SetBeatBookmarksCommand` 一次取代所有節拍書籤(重新分析不會累積,手動書籤不受影響,空陣列 = 清除),一個復原步驟。入口在時間軸工具列的音符按鈕。
  - **依節拍分割**(節拍面板下方):`pickSplitTimes`(純函式,有測試)取選取片段範圍內的節拍,每 1 / 2 / 4 拍一刀;
    `timeline.splitElementsAtTimes` 用 `BatchCommand` 合成一個復原步驟,**由後往前切**(左半一直保留原 id,下一刀才對得到同一個片段),
    並用 `SplitElementsCommand` 的 `keepNames` 避免名稱一直疊 `(left)`。
  - **控制切割數量**:重音模式有「最短間隔」(`pickOnsets` 的 `minGapSeconds`,0.15 / 0.3 / 0.5 / 1 秒),靈敏度 0.5 以下會往嚴格拉(門檻倍率 2.1 → 6.0);
    分割有「最短片段」(`pickSplitTimes` 的 `minGap`,從片段開頭算起,離上一刀或片段頭尾太近的切點略過,保證不會切出更短的片段)與每 1 / 2 / 4 / 8 拍。
    切很多小段、又隨機排序時預覽會吃力(每個切點都要重新定位解碼),先到素材庫對該素材「建立代理檔」(0.5 秒一個關鍵影格)。
  - **重排片段**(同一個面板):`timeline/reorder.ts`(純函式,有測試)對選取的同軌道片段做「隨機打散(可重現的種子,≥3 片時保證和原順序不同)」或「反轉」,
    從原本最早的開始時間起首尾相接(會補掉空隙)。`ReorderElementsCommand` **一次換掉整批 `startTime`**,不走 `UpdateElementsCommand`:
    後者逐筆套用,主軌「最早片段貼齊 0」的規則(`update-pipeline.ts`)會在中途狀態誤判。
  - **一鍵快剪**:`QuickCutCommand` 把「首尾相接(`computeReorder` 的 `pack` 模式)→ 依節拍切(`pickSplitTimes` + `SplitElementsCommand`,由後往前)→ 選擇性打散」
    做成一個復原步驟:**直接呼叫既有指令的 `execute()`**(不經過 `editor.command.execute`,所以不會各自進歷史),`undo` 還原最初的軌道。
    只支援同一條軌道的素材;沒有自己建立新片段(避開 trim / retime 計算),所以也不做「智慧選片」。
- **LUT(.cube)**:解析與打包在 `lut/cube.ts`(純函式,有測試),存在專案的 `project.luts`(id → 名稱、邊長、base64 RGB8)。
  匯入時重新取樣到 0..1 定義域、最多 33³,所以備份與版本紀錄會自動帶著(約 140 KB/個)。id 由內容決定,同一個檔案只存一份;
  目前沒有刪除 LUT 的介面,沒用到的也會留在專案裡。
  - 渲染:`lut/store.ts` 是記憶體快取(載入專案、匯入時登記)。LUT 效果的 pass 帶 `textureId: "lut:<id>"`,
    `frame-descriptor.ts` 的 `attachEffectTextures` 把它當成「rendered」貼圖上傳(N 張切片排成接近正方形的格子,33 → 198×198),
    找不到資料的 pass 會被拿掉。Rust 端 `EffectPassDescriptor.texture_id` → `EffectPass.texture`,LUT 管線多綁一組 group(2)。
  - 需要第二張貼圖卻沒拿到的 pass(縮圖預覽的 `applyEffectPasses` 沒有貼圖庫)在 Rust 會被略過,原圖照常輸出。
  - 介面:`effects/components/lut-picker.tsx`,參數 `lut` 設為 `hidden`(`BaseParamDefinition.hidden`,兩個屬性面板都會略過)。
  - **內建風格**(`lut/presets.ts`,純函式,有測試):id 以 `builtin-` 開頭,第一次用到時由色彩公式產生 33³,
    **不存進專案**(`getStoredLut` 找不到匯入的 LUT 時會退回內建)。LUT 效果預設 `builtin-teal-orange`。
    「負片」是最容易目測 LUT 管線是否正確的一個。

## 專案儲存、備份與重新連結(2026-10)

- **`IndexedDBAdapter.set` 一定是 key 優先**(`{ ...value, id: key }`)。舊版是 `{ id: key, ...value }`,
  匯入備份時備份裡的舊 `id` 蓋掉新 key,把匯入的專案寫到原專案上。`ensureMigrations` 之後會跑
  `repairMismatchedProjectIds`(規則在 `services/storage/project-repair.ts`)修復已經壞掉的紀錄。
- 從資料庫讀出的紀錄帶著 `id` 欄位,另存時一律先拿掉(`const { id: _id, ...rest } = record`)。
- **備份格式第 2 版**:`media[].included`;`false` 表示「只存專案」,匯入後素材只有 metadata、沒有 OPFS 檔案。
  `listMissingMedia` 找出這些素材,`relinkMedia` 依檔名 + 大小(其次唯一同名)對回去(`services/storage/relink.ts`)。
  第 1 版備份沒有 `included`,視為全部含素材。
  「選擇資料夾」(`services/storage/relink-folder.ts`,只有 Chromium 有 `showDirectoryPicker`)遞迴掃描,
  只對檔名符合的檔案呼叫 `getFile()`,略過 `.` 開頭與 `node_modules` 等資料夾,可取消。
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
  - 效果的輸出貼圖由呼叫者提供(`apply_with_encoder` 的 `acquire` 參數):合成器傳入自己的 `TexturePool`,每格回收重用;
    不要改回每個 pass 都 `create_render_texture`。效果不會修改輸入貼圖,所以 `apply_effect_groups` 不必先複製來源。
  - `uploadTexture`:同 id、同尺寸時直接覆寫原貼圖(`Compositor::reusable_texture` + `GpuContext::write_offscreen_canvas_to_texture`),
    播放中的影片不再每格配置新貼圖。
  - 主執行緒裡 mediabunny 的 `CanvasSink` 給的是 **HTMLCanvasElement**(不是 OffscreenCanvas),上傳前要先畫到 OffscreenCanvas。
    `WasmCompositor` 每個貼圖 id 留一張中轉畫布重用(`staging`),不要改回每格 `new OffscreenCanvas`。
    改成直接上傳 `VideoFrame`(`VideoSampleSink`)評估過:會失去 CanvasSink 的旋轉處理與預覽縮小解碼,
    wgpu 的 VideoFrame 來源還要開 `web_sys_unstable_apis`,WebGL 後備也不支援,所以沒做。
  - 高斯模糊的取樣數依 σ 決定(±3.5σ,上限 ±30),不是固定 61 點。
  - 風格化效果(`definitions/stylize.ts`):馬賽克 `pixelate`、色差 `chromatic-aberration`、色調分離 `posterize`、底片顆粒 `film-grain`。
  - 效果定義的 `uniforms` / `buildPasses` 會拿到 `time`(片段開頭起算的秒數,縮圖為 0),會動的效果用它當種子。
    底片顆粒每秒換 24 次圖樣,和匯出幀率無關。
  - 遮罩羽化(`masks` crate)的 JFA 中間貼圖也由呼叫者的 `acquire` 提供,合成器傳入貼圖池。
  - 動態效果(`definitions/motion.ts`):畫面震動 `camera-shake`、放射模糊 `zoom-blur`、故障 `glitch`、鏡像 `mirror`。
    震動與故障用 `time` 與「種子」參數驅動(shader 內 PCG 雜湊),同一時間點預覽與匯出相同。
  - 效果作用在「畫面大小的圖層」上(片段先畫進整張畫面再套效果),所以震動的放大填滿、鏡像都以整個畫面為準。
  - 效果面板會依參數的 `dependencies` 隱藏用不到的欄位。
  - 特效片段的名稱:新建時用定義的中文名稱;時間軸顯示用 `effects/display-name.ts`,
    舊版自動產生的英文名稱(`Film-grain`)會改顯示中文,使用者改過的名稱不變。
- **變速曲線(階梯式近似)**(`retime/speed-ramp.ts` 純函式,有測試;`SpeedRampCommand`):把一個影片片段切成 N 段(素材長度相同),各段套不同的固定 `retime.rate`,總長度不變
  (各段倍率同乘 k = mean(1/m));曲線 = 漸快 / 漸慢 / 子彈時間(中間慢)/ 中間衝刺,強度 1 = 最慢最快相差 4 倍。倍率超過 0.01~5、或單段短於 0.1 秒時 `planSpeedRamp` 回 `ok: false`,介面停用按鈕並顯示原因。
  **為什麼不做連續曲線**:retime 格式只有單一倍率,連續曲線要動專案格式(要寫遷移),縮放 / 分割 / 裁切 / 音訊 / 代理檔都得改,而且沒有影格混合,慢速時本來就會一格一格,維護成本高、收益有限。
  指令做法同 `QuickCutCommand`:直接呼叫 `SplitElementsCommand.execute()` 由後往前等分(左半保留原 id),之後只更新一次時間軸狀態(各段 retime / startTime / duration,最後一段吃掉進位誤差),`isSourceAudioEnabled: false`;一個復原步驟。
  限制:只支援影片、聲音靜音、不做關鍵影格的時間重映射(片段上原有的動畫被切到對應段)、段數太多預覽會吃力(先建立代理檔)。
- **PV 畫面效果**(`definitions/pv.ts`,2026-10-28):網點、雙色調、VHS 錄影帶、集中線、波浪扭曲、漏光、魚眼,每個一支 shader、單一 pass、只看當下這格的這個圖層(沒有歷史影格、沒有額外貼圖)。
  uniform 只有 6 個可用浮點數(8 個扣掉 `resolution`),所以雙色調用「色相 + 共同飽和度」而不是兩個 RGB 色;集中線的中心固定在畫面中心。
  強度為 0 時 `skipWhen` 成立不送 pass;會動的(VHS、集中線、波浪、漏光)用 `time` 驅動,集中線每秒換 12 組、VHS 每秒 24 次換雜訊,預覽與匯出相同。
  **WGSL 注意**:naga 會檢查 `textureSample` 必須在「一致的控制流程」裡呼叫,不要在依每個像素而定的 `if` / 提早 `return` 之後取樣,分支用 `select`(這批 shader 都是這樣寫的)。
- **效果組合**(`effects/presets.ts`,純資料,有測試):把幾個特效打包(衝擊、復古膠卷、電影感、賽博故障、夢幻柔光),
  特效面板上方點一下就在播放頭放入;每層一個特效片段,用 `timeline.insertElements`(`BatchCommand`)合成一個復原步驟,
  自動放軌(重疊的會分到不同軌道)。參數只寫覆寫值;新增組合時測試會檢查特效類型、參數 key 與範圍。
- **轉場(進出場動畫)**:`transitions/presets.ts` 是純函式,把動畫展開成關鍵影格(動畫基準值要從 `element.params` 讀,不是 `element.opacity` 這類不存在的欄位)。測試在 `transitions/__tests__/`。
- **LRC / 點拍同步**(`subtitles/lrc.ts`、`timed-lines.ts`,純函式,有測試):`parseLrc` 接在 `parse.ts` 的 `case "lrc"`。
  每句結束 = 下一個時間點(含空文字行的結束標記),最後一句 4 秒,單句最長 10 秒(`LAST_LINE_SECONDS` / `MAX_LINE_SECONDS`);
  同一時間點的多行(原文 + 翻譯)合併成一則;`[offset:+ms]` 讓字幕提早;逐字時間戳 `<mm:ss.xx>` 去掉只留整句。
  點拍(`lyrics-tap.tsx`):時間取自 `editor.playback.getCurrentTime()` 再減「按鍵補償」(預設 0.1 秒),按鍵只寫進 ref,
  在 **window 捕獲階段**攔空白 / 退格(全域快捷鍵掛在 document,不攔會變成播放 / 暫停);完成時用 `insertCaptionChunksAsTextTrack` 一次寫入(單一復原步驟)。
  注意:播放頭是 `requestAnimationFrame` + `performance.now` 推算的,不是直接讀音訊時鐘,所以點拍精度受補償值影響。
- **匯出字幕**(`subtitles/serialize.ts`,純函式,有測試):文字片段的 `params.content` + 開始 / 長度寫成 SRT 或 LRC(LRC 在下一句前有空檔時補結束標記,讀回來長度一致)。
  有選取時只匯出選取的文字片段,否則全部。**和使用者另一個專案 kinetic-lyric-console(KLC)搭配**:KLC 是 DOM / CSS 動畫 + Playwright 離線渲染,原理不同,不移植進來;
  流程是這裡對時間 → 匯出 SRT → KLC 上動態效果 → KLC 的綠幕輸出(`--chroma`)放回時間軸加「去背(綠幕)」。KLC 的透明輸出是 ProRes 4444 / VP9 alpha WebM,
  瀏覽器解 ProRes 不行;VP9 alpha 經 mediabunny 解碼能不能保留 alpha **沒確認**(綠幕會丟掉 KLC 的發光 / 陰影)。
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
