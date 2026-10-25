# OpenCut（精簡網頁版）

在瀏覽器裡剪輯影片的工具，**檔案只在你的電腦上處理，不會上傳**。

這是 [OpenCut](https://github.com/opencut-app/opencut-classic) 舊版（已封存）的精簡分支：
去掉網站、帳號、資料庫與後端，只保留編輯器本體，並把 Next.js 換成 Vite，
建置後是一包純靜態檔案，放在任何靜態主機（GitHub Pages 等）都能執行。

## 已有的功能

- 多軌時間軸、分割、拖放排序、變速
- 關鍵影格與貝茲曲線編輯器（位置、縮放、旋轉、不透明度、音量、效果參數等）
- 遮罩（含自由繪製與羽化）、混合模式
- 文字、貼圖、字幕與語音轉文字（在瀏覽器內執行）
- 逐幀離線匯出（MP4 / WebM），不需即時錄製
- 專案儲存在瀏覽器本機（IndexedDB / OPFS）

## 使用

網址：`https://<你的帳號>.github.io/opencut-classic/`

## 瀏覽器需求

需要較新的桌面瀏覽器（Chrome、Edge、Firefox、Safari），並支援 WebCodecs。
渲染優先使用 WebGPU，不支援時退回 WebGL。

## 本機開發

```bash
bun install
cd apps/web
bun run dev        # http://localhost:3000
bun run build      # 輸出到 apps/web/dist
bun run typecheck
```

## 目前的限制

- 沒有轉場，效果庫只有高斯模糊一種。
- 介面尚未提供繁體中文。
- 匯出結果先放在記憶體，過長的影片會吃很多記憶體。
- 「Sounds」音效搜尋分頁已移除（它依賴原本的後端服務）。

## 授權與來源

MIT 授權，原始碼來自 OpenCut，著作權屬原作者，詳見 [LICENSE](LICENSE)。


## 近期新增

- 繁體中文介面、Noto Sans TC 字型
- 濾鏡:色彩調整、黑白、復古褐色、暗角(自訂 GPU 著色器,由 GitHub Actions 編譯 WASM)
- 轉場面板:淡入、淡出、淡入淡出(以關鍵幀實作)
- 定格(freeze frame)、復原/重做按鈕
- 匯出直接串流寫入硬碟(Chrome / Edge)
- 專案備份檔(`.opencut-backup`)匯出與匯入
- 離線模式(預設關閉,可在「儲存空間」視窗開啟)
