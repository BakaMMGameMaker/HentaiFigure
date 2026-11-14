# HentaiFigure

> 私人的手办收藏室 · 每日上贡。

HentaiFigure 是一个**完全本地运行**的收藏管理应用（Windows 桌面 + Android 手机）：收藏图鉴、每日「擦拭 / 意淫 / 教唆」流程、上贡日历，以及一位会记住旧账、还会在每晚主动来找你的「收藏室女管理员」。界面和交互思路参考了 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，但对话、记忆和收藏数据都由本应用自己管理，直接调用 DeepSeek 的 OpenAI 兼容 Chat Completions API。

官方仓库：https://github.com/BakaMMGameMaker/HentaiFigure

---

## 一键启动

要求：Windows 10 / 11，安装 [Node.js 22 或更高版本](https://nodejs.org/)（只需要装一次）。

1. 双击 **`启动.bat`**。
2. 第一次启动会自动安装依赖并构建界面，可能需要一两分钟；之后每次启动只需几秒。
3. 出现窗口后，点右上角的 **设置**，填入 DeepSeek API Key。

已经打包好的免安装便携版在 **`release\HentaiFigure-1.2.0-portable.exe`**，双击也能直接打开（不需要 Node.js）。数据同样在 `%APPDATA%\HentaiFigure`。不过便携版不支持应用内自动更新；想用自动更新就双击 `启动.bat` 的源码方式运行。

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
- **手机版**的 Key 保存在应用沙箱的 IndexedDB 中，没有 DPAPI 那样的系统级加密；请给手机设置锁屏密码。
- 默认模型 `deepseek-flash` 支持图片输入。如果你换成 `deepseek-chat` / `deepseek-reasoner` 等纯文本模型，应用会自动不发图片，只把照片标签、商品详情和心路历程交给模型，避免接口报错。
- 也支持任何 OpenAI 兼容的代理地址；如果代理带 `/v1`，直接填到 `/v1` 之前或之后都可以，程序会自动拼接 `/chat/completions`。

### 2. 添加第一件周边

点左上角 **添加**：

- **状态**：已拥有 / 待补款 / 观望中（购物车）。
- **类型**：手办、亚克力立牌、抱枕、海报、徽章、痛包、毛绒、其他。
- **基本信息**：名称、规格，以及从下拉框里选一个**角色**（见下）。
- **价格**：原始价格、购入价格、定金、尾款（填了购入价和定金后可以一键算尾款参考）。
- **补款日期**：待补款时填写。
- **商品详情**：这款周边本身是什么——哪家厂、哪个系列、尺寸材质、发售时间。管理员靠它知道这个 IP 的这款东西究竟是什么。
- **最初的想法**：你买下或加购时的心路历程。管理员会从这里找话题。
- **照片**：至少一张。可以点「上传照片」多选，也可以直接把图片拖进窗口。
  - 已拥有的**手办**必须至少有一张「全身照」。
  - 其它可选部位：脸蛋、腋下、胸部、美背、肚子、私处、屁股、裙底、大腿、玉足。
  - 每张照片都可以改标签、写备注、随时删除；删除最后一张会被拒绝。

#### 角色档案

「角色」是一个可以搜索的下拉框：

- 第一次录入某个角色时，选 **+ 新增角色**，填角色名、出自作品和一段角色背景，保存后会自动关联到这件藏品。
- 之后再录同一角色的周边，直接在搜索框里输入「初音」就能选中它；下拉框、选中态都是深色风格，不会跳出系统白底。
- 一个角色可以关联任意多款周边。管理员会自动拿到角色档案（作品、背景、这个角色名下还有哪些周边），对一个 IP 的了解更完整；她也多了 `list_characters` / `read_character` 两个工具可以主动查。
- 老版本里手填的「作品 / 角色」会在升级时自动变成角色档案并挂到对应藏品上，不会丢。
- 点「编辑角色」可以随时补全背景设定。

### 3. 每日上贡

首页中间的 **今日份上贡** 按钮会依次走完：

1. **擦拭** — 从已拥有的周边里随机挑一款，管理员先看着照片开口，你回，管理员接，直到你点「擦拭完毕」。
2. **意淫** — 从待补款里随机挑一款，只能看宣传图，先想个够。
3. **教唆** — 从购物车里挑一款，管理员会逼你下单；结束时选择：
   - 下单了 · 等补款 → 移入待补款；
   - 下单了 · 已经到手 → 移入已拥有；
   - 还没 · 继续观望 → 保持原样，这段对话照样归档。

每个阶段结束后会显示「开始下一阶段」。全部完成后显示 **今日已上贡**，并在日历上留下勾。

- 中途离开不会丢进度：首页会变成「继续上贡」。
- 每个阶段的对话都会自动生成摘要，归档到这款周边的记忆里。
- 管理员可以通过工具翻阅**任何**过去的上贡记录和对话（`search_memory` / `read_memory` / `list_events` / `read_item` / `list_collection`）。

### 4. 日历与记忆

- **日历**：有上贡的日子会打勾；点任意一天可以看到当天每个阶段的摘要和完整对话。
- **记忆库**：按日期、阶段、周边筛选全部对话；可以重读原文。这些也是管理员翻旧账的素材。

### 5. 和管理员聊天

首页的「收藏室管理员」卡片、或底部导航的 **对话**，可以进入日常聊天：

- 不是上贡流程，随便聊收藏、尾款、旧事和今天的心情。
- 管理员会带着全部上贡记忆和收藏室资料开口，也会自己调用记忆工具翻旧账。
- **对话记录**（左侧，手机上是「历史」抽屉）：像 chat-demo 那样按今天 / 昨天 / 7 天内 / 30 天内 / 按月分组，每条都有标题和预览；点标题切换对话，点「⋯」可以重命名或删除，右上角「新建」开一段新对话。
- **新藏品会自动开一段对话**：收录一件新周边后，管理员会就这款藏品主动开口（她真的看得到照片和资料）；之后每次编辑藏品，她也会针对前后差异重新开口——改了价格、换了状态、补了心路历程，都逃不过。
- **每日主动话题**：在「设置 → 管理员」里开启并设定时间（默认 22:00）。到点后管理员会读取记忆，主动发一条相关话题；如果那时应用没开，下次启动会补上。
- 也可以在设置里点「让她来一条」，立刻生成一条主动话题。
- 主动消息会弹系统通知；点通知直接打开对话。手机上则是在应用打开/切回前台时检查。
- **管理员头像和昵称**：在「设置 → 管理员」里可以上传管理员头像、设置她怎么称呼你（默认「杂鱼」）。头像会出现在首页、对话页和上贡界面。

---

## 数据、备份与隐私

所有数据都在：

```text
%APPDATA%\HentaiFigure\data\
├─ config.json       # 设置（含昵称、管理员头像）；API Key 加密保存
├─ items.json        # 收藏与照片元数据（含商品详情 / 最初的想法）
├─ characters.json   # 角色档案：角色名、作品、背景，可被多款周边共用
├─ sessions.json     # 每轮对话与记忆摘要
├─ daily.json        # 每日上贡进度与完成记录
├─ freechat.json     # 与管理员的日常对话（多段会话）、主动话题记录
├─ images\           # 原图 + 缩略图
└─ backups\          # 自动 / 手动备份（最多保留 12 份）
```

- 应用不会把数据写进程序目录，所以**更新程序不会丢收藏和记忆**。
- 每次自动更新、导入备份前都会先在本机备份。
- 设置 → 数据：可以打开目录、立即备份、导出 ZIP、导入 ZIP。
- 「照片、记忆与 API Key 都只留在这台电脑上」这句话现在放在 **设置 → 关于**，不再显示在首页。
- 照片、对话、API Key 都不会上传到除你配置的 DeepSeek API 之外的任何地方。
- 对话内容由 DeepSeek 生成；删除数据目录等于清空整个收藏室。

---

## 自动更新

更新源已写死为官方仓库：

**https://github.com/BakaMMGameMaker/HentaiFigure**

不需要在设置里填写任何仓库地址，也不开放更新源配置。应用只替换程序文件，不碰数据目录。

- **启动时自动检查**：桌面启动约 3 秒、手机启动约 5 秒后检查一次；可以在「设置 → 更新」关闭。
- **源码方式（`启动.bat`）**：当前目录是官方仓库的 git clone 时，会 `git fetch` 并比较 `origin/master`。点「更新并重启」会：备份数据 → `git fetch` → `git reset --hard @{u}` → 必要时 `npm install` → `npm run build` → 自动重启。
- **便携版 / 手机版**：读取官方仓库最新 Release（或 `master` 分支的 `package.json`）判断版本。发现新版本会显示版本差异和发布页；便携版 exe / APK 不能自替换，请下载新文件覆盖安装。
- **发版规则**：修改 `package.json` 的 `version` → 提交并推送 `master` → 打 `vX.Y.Z` tag → 在 GitHub 创建 Release（附上 APK / 便携版 exe）。
- **手动更新**：双击 `更新.bat`，会从 `origin` 拉取、安装依赖并重新构建。

> 更新会丢弃你在程序目录里对代码做的本地改动，所以不要把重要东西写在代码目录。收藏和记忆在 `%APPDATA%` 或手机应用数据里，不会丢。

---

## 手机版（Android APK）

手机版和电脑共用同一套 React 界面与数据格式，用 Capacitor 包成 Android APK。聊天、收藏、上贡流程、日历、记忆、主动话题、同步和 GitHub 更新检查都在。

### 安装

已经构建好的 APK 在：

```text
release\HentaiFigure-1.1.0-android.apk
```

（源码构建产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。）

用数据线连接手机并开启 USB 调试后：

```bat
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

也可以把 APK 发到手机上直接安装（需要允许安装未知来源应用）。当前 APK 使用 debug 签名，适合自己安装使用；如果要上架应用商店，需要自己配置 release 签名。

### 自己构建 APK

需要 Node.js 22+、JDK 17 或 21、Android SDK（compileSdk 35）：

```bat
npm run android:apk
```

脚本会构建 `mobile-dist/`、同步 Capacitor 资源并调用 Gradle。第一次构建会下载 Gradle 和 Android 依赖，可能需要几分钟。

### 与电脑同步

手机数据保存在应用自己的 IndexedDB 里；用 ZIP 同步包与电脑交换：

1. **电脑 → 手机**：电脑「设置 → 数据 → 导出备份 ZIP」；把文件传到手机；手机「设置 → 数据 → 导入备份」。
2. **手机 → 电脑**：手机「设置 → 数据 → 导出备份 ZIP」，用系统分享发到电脑；电脑「设置 → 数据 → 导入备份」。
3. 同步包包含 `items.json`、`sessions.json`、`daily.json`、`freechat.json` 和 `images/`。
4. 手机导入会按 ID **合并**收藏、对话和日常聊天；电脑导入是覆盖式，导入前会自动备份。建议同步前先各导出一次。
5. 手机导出**不包含 API Key**；电脑导出里的加密 Key 手机导入时会忽略。

### 手机上的 GitHub 更新检查

「设置 → 更新」会显示写死的官方仓库地址。打开「启动时自动检查」后，手机会读取 GitHub Release（或 master 分支的 `package.json`）判断是否有新版本。

手机版不能应用内替换 APK；发现新版本后会给出发布页入口，下载新 APK 覆盖安装即可。收藏和记忆在应用数据里，覆盖安装不会丢。实际上，`version` 要大于当前 `1.1.0` 才会提示。

### 手机版限制

- API Key 保存在应用沙箱的 IndexedDB 中（没有桌面端 DPAPI 那样的系统级加密）；请给手机设置锁屏密码。
- 每日主动话题只在**应用打开或切回前台**时检查；没有常驻后台服务。
- 系统通知使用的是应用内提示，不依赖通知权限。
- 手机端照片会先压缩成 JPEG 再保存和发送，单张不超过 60MB。

---

## 开发

```bat
npm install
npm run dev           :: Vite + Electron 热开发
npm run type          :: TypeScript 类型检查
npm run build         :: 只构建 Windows 渲染层
npm run build:mobile  :: 构建手机 Web 资源（mobile-dist/）
npm run android:sync  :: 构建手机资源并同步到 Android 工程
npm run android:apk   :: 构建 debug APK
npm run pack          :: 打包 Windows 便携版（release/）
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
  pages/              首页、收藏、上贡、日历、对话、记忆
  components/         编辑器、设置、详情、对话弹窗
  styles.css          桌面视觉样式
mobile/
  main.tsx            手机入口
  api.ts              window.hf 的浏览器/IndexedDB 实现
  store.ts            手机本地存储
  engine.ts           手机端上贡状态机、记忆、主动话题
  sync.ts             ZIP 同步包导入导出
  mobile.css          手机端响应式覆盖
android/              Capacitor 生成的 Android 工程
scripts/
  dev.cjs             开发启动器
  ensure-electron.cjs 修复 Electron 运行时
  启动.bat / 更新.bat / 创建桌面快捷方式.bat
```

### 数据模型（简）

- `Item`：状态、类型、价格、`characterId`、`detail`（商品详情）、`thought`（最初的想法）、补款日、照片数组、各种 `last*At`。
- `Character`：角色名、`source`（出自作品）、`description`（角色背景）；多件 `Item` 可以共用同一个角色。
- `Session`：`phase`（wipe / fantasy / instigate）、`messages`、`summary`、`outcome`、`archived`。
- `DailyRecord`：三个阶段的 `status`、`itemId`、`sessionId`，以及 `completedAt`。
- `FreeChat`：`threads`（每段日常对话的标题、消息、`origin`）、`activeId`、`lastProactiveDay`；和上贡记忆分开存，但管理员可以用工具翻阅两边。
- 工具可读取全部 `Session`、`Character` 和 `Item`，所以记忆中不需要冗余拷贝。

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

**更新检查失败**
更新源已固定为官方仓库，不需要填写。检查网络能否访问 GitHub；如果使用源码方式，确认当前目录是官方仓库的 git clone 且 origin 指向正确。

**中文在命令行里乱码**
批处理文件已经 `chcp 65001`；如果仍乱码，把终端字体换成支持中文的字体即可，不影响应用。

**手机版同步后照片不显示**
同步时手机和电脑都要选择完整 ZIP。电脑导出时不要把 `images/` 单独拆出去；手机导入后应用会自动刷新。若只同步了 JSON，照片会缺。

**手机版检查更新显示已是最新，但 GitHub 有新版本**
手机端比较的是应用版本号（当前 `1.2.0`）和 Release/tag；发布时记得把 `package.json` 的 `version` 改大，并打上对应的 tag。

**手机版没有在后台主动发消息**
这是设计如此：Android 后台定时不可靠，手机版只在应用打开或切回前台时补检查一次。

**Android 构建失败**
确认 `D:\android-sdk` 存在 platform 35，且 `JAVA_HOME` 指向 JDK 17/21；首次构建会从 Gradle/Maven 下载依赖。如果网络慢，可以给 Gradle 配国内 Maven 镜像后重试。

---

## 内容说明

HentaiFigure 是个人使用的虚构角色周边收藏管理工具。生成内容配置的 DeepSeek API 产生。

本项目受 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）启发；未直接复制其源码。界面与代码以 MIT 协议发布，详见 [LICENSE](LICENSE)。

---

## 更新日志

### v1.2.0

- 首页：去掉底部那行隐私说明（移入 **设置 → 关于**），问候语改成可点击换一句，删掉「换一句」按钮，上贡按钮居中；顶部只保留日期。
- 管理员：可以上传头像、设置她怎么称呼你；头像和昵称会用在首页、对话、上贡和记忆摘要里。
- 角色档案：录入藏品时的「角色」变成可搜索下拉框，支持「+ 新增角色」，填角色名 / 作品 / 角色背景；一个角色可以挂多款周边，管理员也能读到角色背景。老数据会自动迁移。
- 藏品资料拆成 **商品详情** 和 **最初的想法** 两段，管理员分别拿来知道「这是什么」和「你为什么买」。
- 新增 / 编辑藏品后，管理员会主动就这款藏品（或这次的改动）开一段对话。
- 日常对话加入历史记录：按时间分组、标题、重命名、删除、新建。
- 修掉几处「露馅」文案（例如简介旁边原来会写「DeepSeek 会从这里找话题」）。
- 默认人格换成新的毒舌管理员版本（你自定义过的提示词不会被覆盖）。
