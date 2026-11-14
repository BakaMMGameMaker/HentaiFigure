# HentaiFigure

> 私人的手办收藏室 · 每日上贡。

HentaiFigure 是一个**完全本地运行**的 Windows 桌面应用：桌面窗口、收藏图鉴、每日「擦拭 / 意淫 / 教唆」流程、上贡日历和会记住旧账的 DeepSeek 对话。界面和交互思路参考了 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，但对话、记忆和收藏数据都由本应用自己管理，直接调用 DeepSeek 的 OpenAI 兼容 Chat Completions API。

---

## 一键启动

要求：Windows 10 / 11，安装 [Node.js 22 或更高版本](https://nodejs.org/)（只需要装一次）。

1. 双击 **`启动.bat`**。
2. 第一次启动会自动安装依赖并构建界面，可能需要一两分钟；之后每次启动只需几秒。
3. 出现窗口后，点右上角的 **设置**，填入 DeepSeek API Key。

已经打包好的免安装便携版在 **`release\HentaiFigure-1.0.0-portable.exe`**，双击也能直接打开（不需要 Node.js）。数据同样在 `%APPDATA%\HentaiFigure`。不过便携版不支持应用内自动更新；想用自动更新就双击 `启动.bat` 的源码方式运行。

想把快捷方式放到桌面，双击 **`创建桌面快捷方式.bat`**。

> `启动.bat` 每次都会重新构建 `dist/`，所以改过代码后直接双击就能看到最新界面。
> 如果 Electron 运行时缺失，启动器会调用 `scripts/ensure-electron.cjs` 自动修复。

---

## 第一次使用

### 1. 连接 DeepSeek

在「设置 → API」里填写：

| 项 | 建议值 |
| --- | --- |
| API Key | 你的 `sk-...` |
| API 地址 | `https://api.deepseek.com` |
| 模型 | `deepseek-flash`（支持看图） |

点「测试连接」确认能通。

- API Key 只保存在本机，并使用 Electron 的系统安全存储（Windows DPAPI）加密；界面里不会回显完整 Key。
- 默认模型 `deepseek-flash` 支持图片输入。如果你换成 `deepseek-chat` / `deepseek-reasoner` 等纯文本模型，应用会自动不发图片，只把照片标签和简介交给模型，避免接口报错。
- 也支持任何 OpenAI 兼容的代理地址；如果代理带 `/v1`，直接填到 `/v1` 之前或之后都可以，程序会自动拼接 `/chat/completions`。

### 2. 添加第一件周边

点左上角 **添加**：

- **状态**：已拥有 / 待补款 / 观望中（购物车）。
- **类型**：手办、亚克力立牌、抱枕、海报、徽章、痛包、毛绒、其他。
- **基本信息**：名称、作品 / 角色、规格。
- **价格**：原始价格、购入价格、定金、尾款（填了购入价和定金后可以一键算尾款参考）。
- **补款日期**：待补款时填写。
- **简介**：你最初看到她时的感想。DeepSeek 会从这里找话题。
- **照片**：至少一张。可以点「上传照片」多选，也可以直接把图片拖进窗口。
  - 已拥有的**手办**必须至少有一张「全身照」。
  - 其它可选部位：脸蛋、腋下、胸部、美背、肚子、芒果、屁股、裙底、大腿、玉足。
  - 每张照片都可以改标签、写备注、随时删除；删除最后一张会被拒绝。

### 3. 每日上贡

首页中间的 **今日份上贡** 按钮会依次走完：

1. **擦拭** — 从已拥有的周边里随机挑一款，她先看着照片开口，你回，她接，直到你点「擦拭完毕」。
2. **意淫** — 从待补款里随机挑一款，只能看宣传图，先想个够。
3. **教唆** — 从购物车里挑一款，她会逼你下单；结束时选择：
   - 下单了 · 等补款 → 移入待补款；
   - 下单了 · 已经到手 → 移入已拥有；
   - 还没 · 继续观望 → 保持原样，这段对话照样归档。

每个阶段结束后会显示「开始下一阶段」。全部完成后显示 **今日已上贡**，并在日历上留下勾。

- 中途离开不会丢进度：首页会变成「继续上贡」。
- 每个阶段的对话都会自动生成摘要，归档到这款周边的记忆里。
- 她可以通过工具翻阅**任何**过去的上贡记录和对话（`search_memory` / `read_memory` / `list_events` / `read_item` / `list_collection`）。

### 4. 日历与记忆

- **日历**：有上贡的日子会打勾；点任意一天可以看到当天每个阶段的摘要和完整对话。
- **记忆库**：按日期、阶段、周边筛选全部对话；可以重读原文。这些也是她翻旧账的素材。

---

## 数据、备份与隐私

所有数据都在：

```text
%APPDATA%\HentaiFigure\data\
├─ config.json       # 设置；API Key 加密保存
├─ items.json        # 收藏与照片元数据
├─ sessions.json     # 每轮对话与记忆摘要
├─ daily.json        # 每日上贡进度与完成记录
├─ images\           # 原图 + 缩略图
└─ backups\          # 自动 / 手动备份（最多保留 12 份）
```

- 应用不会把数据写进程序目录，所以**更新程序不会丢收藏和记忆**。
- 每次自动更新、导入备份前都会先在本机备份。
- 设置 → 数据：可以打开目录、立即备份、导出 ZIP、导入 ZIP。
- 照片、对话、API Key 都不会上传到除你配置的 DeepSeek API 之外的任何地方。
- 对话内容由 DeepSeek 生成；删除数据目录等于清空整个收藏室。

---

## 自动更新

应用内置更新检查，**只替换程序文件，不碰上面的数据目录**。有两种更新源：

### 方式 A：git 仓库（推荐）

在程序目录初始化并推送到你自己的 GitHub 仓库：

```bat
git init
git add .
git commit -m "HentaiFigure v1.0.0"
git branch -M main
git remote add origin https://github.com/<你>/<仓库>.git
git push -u origin main
```

之后每次发布新版本，只要：

1. 修改 `package.json` 里的 `version`；
2. `git commit` + `git push`。

启动应用 3 秒后会自动 `git fetch` 检查；首页会出现「发现新版本」提示。点更新后应用会：
备份数据 → `git fetch` → `git reset --hard @{u}` → 必要时 `npm install` → `npm run build` → 自动重启。

> 更新会丢弃你在程序目录里对代码做的本地改动，所以请不要把重要东西写在代码目录。收藏和记忆在 `%APPDATA%` 里，绝对是安全的。

### 方式 B：GitHub 仓库 + 版本号

在「设置 → 更新」里填写 `owner/repo`，并把版本号推上去。应用会读取最新 Release，或 `main` 分支的 `package.json`；发现更高版本就下载 zip、解压、替换程序文件、安装依赖、重新构建。

- 只有 `package.json` 的 `version` 变大才会触发 zip 更新（所以发版记得改版本号）。
- 更新源不填、当前目录也没有 git remote 时，检查会提示「未配置更新源」，不会报错。

### 手动更新

双击 **`更新.bat`**：有 git remote 就 `git pull --ff-only`，然后 `npm install` + `npm run build`。

### 注意

用 `npm run pack` 打出来的便携版 exe 由于程序在 asar 里，**不支持应用内自动更新**；请直接下载新版本替换 exe。想要自动更新，就用 `启动.bat` 的源码方式运行。

---

## 开发

```bat
npm install
npm run dev      :: Vite + Electron 热开发
npm run type     :: TypeScript 类型检查
npm run build    :: 只构建渲染层
npm run start    :: 构建后启动
npm run pack     :: 打包 Windows 便携版（release/）
```

目录结构：

```text
electron/
  main.cjs            主进程：窗口、IPC、图片协议、备份、更新
  preload.cjs         安全桥接
  lib/store.cjs       JSON 持久化、API Key 加密
  lib/deepseek.cjs    SSE 流式调用、图片压缩、错误映射
  lib/ritual.cjs      上贡状态机、记忆、工具、阶段摘要
  lib/updater.cjs     git / GitHub zip 更新
src/
  App.tsx             页面与状态
  pages/              首页、收藏、上贡、日历、记忆
  components/         编辑器、设置、详情、对话弹窗
  styles.css          全部视觉样式
scripts/
  dev.cjs             开发启动器
  ensure-electron.cjs 修复 Electron 运行时
  启动.bat / 更新.bat / 创建桌面快捷方式.bat
```

### 数据模型（简）

- `Item`：状态、类型、价格、简介、补款日、照片数组、各种 `last*At`。
- `Session`：`phase`（wipe / fantasy / instigate）、`messages`、`summary`、`outcome`、`archived`。
- `DailyRecord`：三个阶段的 `status`、`itemId`、`sessionId`，以及 `completedAt`。
- 工具可读取全部 `Session`，所以记忆中不需要冗余拷贝。

---

## 常见问题

**窗口没出现 / 双击没反应**
查看是否安装了 Node.js 22+；在目录里手动运行 `npm install`，再运行 `node scripts/ensure-electron.cjs`。也可以删除 `node_modules\electron` 后重新 `npm install`。

**401 / 402 / 429**
分别是 API Key 无效、余额不足、请求太频繁。应用会把错误显示在对话里。

**模型说看不到照片**
确认模型是 `deepseek-flash`（或代理支持多模态）。纯文本模型会按设计退化为「照片标签」模式。

**照片显示不出来**
确认文件仍在 `%APPDATA%\HentaiFigure\data\images\`；不要手动移动/改名。应用启动时会清理没有被任何周边引用的孤儿文件。

**更新提示未配置**
在设置里填 `owner/repo`，或者给程序目录加 git remote。只有配置了更新源才会真的去 GitHub 拉取。

**中文在命令行里乱码**
批处理文件已经 `chcp 65001`；如果仍乱码，把终端字体换成支持中文的字体即可，不影响应用。

---

## 内容说明

HentaiFigure 是给成年人个人使用的虚构角色收藏管理工具。所有角色、周边与对话均为虚构；请不要把真实人物带入对话。生成内容由你配置的 DeepSeek API 产生，请遵守当地法律、DeepSeek 的服务条款以及你所在平台的规定。

本项目受 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）启发；未直接复制其源码。界面与代码以 MIT 协议发布，详见 [LICENSE](LICENSE)。
