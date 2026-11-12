/**
 * The release notes the settings page's 版本记录 tab pages through, newest first. They live
 * as data rather than as the repository's `docs/release-notes/v*.md` files because the client is a
 * browser bundle with no markdown reader, and this tab should read the same offline.
 * @module dsh-ccgui/client/release-notes
 */

/** One line of a release's notes; the optional `title` is the bold lead-in. */
export interface ReleaseNoteItem {
  readonly title?: string
  readonly text: string
}

/** One heading and its lines. */
export interface ReleaseNoteSection {
  /** The category, e.g. `✨ 新功能`, as the release notes file writes it. */
  readonly heading: string
  readonly items: readonly ReleaseNoteItem[]
}

/** One page of the 版本记录 tab. */
export interface ReleaseNote {
  /** Without the leading `v`, like package.json's version. */
  readonly version: string
  /** The release date, ISO-shaped like the notes file's 发布日期. */
  readonly date: string
  readonly sections: readonly ReleaseNoteSection[]
}

/** In display order: the first page is the newest release. */
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '1.0.6',
    date: '2026-11-12',
    sections: [
      {
        heading: '✨ 新功能',
        items: [
          {
            title: 'CLI 自己的模式',
            text: 'CLI 名字右边新增「CLI 模式」按钮，列的是该 CLI 通过 ACP 报告的模式，id 和名字原样发送，不映射成 DSH 的权限预设；进程在运行时选中当场生效，还没起来时随下一条消息发出，按钮上有标注。CLI 不接受时消息照常发出，回复会说明按哪个模式运行。',
          },
          {
            title: '「EXP 自动审查」可以在 CLI 会话里用',
            text: '审查请求转给一个独立、无状态的模型提供方，不进入 CLI 的会话历史。需要在插件配置里指定 `reviewProvider`（不能是 CLI）和可选的 `reviewModel`；插件不会替你挑选，没配置时会提示。',
          },
          {
            title: '模型图标按厂商显示',
            text: '新认 Hunyuan、智谱、MiniMax、阶跃 StepFun 和小米 MiMo；聚合 CLI 里不再让所有模型都显示 CLI 自己的 logo，认不出厂商的用中性问号占位。',
          },
          {
            title: '模型倍率写在名字右边',
            text: '模型名保持 CLI 给的原样，右侧小字显示它报的简短描述，比如 CodeBuddy 的 `x0.29 credits`；同名的免费档和付费档靠它区分，宣传语一类的长句不上屏。',
          },
          {
            title: '原生会话保留自己的模型菜单',
            text: '非 CLI 会话不再换掉 DSH 自己的模型座位，推理等级和智能体团队协作开关留在原位；插件只隐藏原生菜单里切不过去的 CLI 分组。',
          },
        ],
      },
      {
        heading: '🐛 问题修复',
        items: [
          {
            title: 'CLI 拒绝时说明原因',
            text: '按顺序从本轮输出、回答 `_meta` 里的具名字段（如 CodeBuddy 的 `codebuddy.ai/errorMessage`）和这一轮 stderr 的最后两行里找原因；诊断 JSON、trace 头不显示，都没有时写「未说明原因」。',
          },
          {
            title: '完全权限下 CLI 提问不再被静默拒绝',
            text: '只在 CLI 提问期间把会话临时切到「询问」，问完恢复；改动不再凭空消失，屏幕上会出现审批卡片。',
          },
          {
            title: '模式按钮的提示会自己消失',
            text: 'CLI 收下模式后，按钮上的「下一条消息发送时生效」自动去掉，不用重开菜单。',
          },
        ],
      },
      {
        heading: '📄 文档',
        items: [
          { text: 'README 补充 CLI 模式、自动审查配置、拒绝原因和模型图标与倍率小字的说明。' },
          { text: '`THIRD_PARTY_NOTICES.md` 补新图标的来源，开发一节与 AGENTS.md 对齐。' },
        ],
      },
      {
        heading: '🔧 维护',
        items: [
          {
            text: '新增 CLI 模式的状态、路由和界面，以及只在 CLI 提问期间生效的审批策略；e2e 改为逐帧读取会话日志。版本号升到 1.0.6。',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.5',
    date: '2026-11-09',
    sections: [
      {
        heading: '✨ 新功能',
        items: [
          {
            title: '项目右键新建 Worktree',
            text: '左侧栏项目右键「新建 Worktree…」，可以从新分支、已有分支或 PR 创建 Git worktree；默认放在仓库同级的 `<仓库名>-worktrees/<分支名>`，创建后加入侧边栏，也可以立刻在里面打开新会话。',
          },
          {
            title: '从 PR 创建不需要 gh',
            text: '接受 `123`、`#123` 或 PR 链接，从 `refs/pull/<编号>/head` 拉取；有 `upstream` 时优先用它，填链接时按链接里的仓库匹配远程。',
          },
          {
            title: 'worktree 收进仓库分组',
            text: '侧边栏把 worktree 收进所属仓库的「Worktrees · N」分组，展开状态会记住；右键 worktree 或会话仍是 DSH 自己的菜单。分组依赖侧边栏结构，DSH 改结构时 worktree 退回顶层显示。',
          },
          {
            title: '可以关掉',
            text: '设置页新增「项目右键新建 Worktree」开关，默认开启。',
          },
        ],
      },
      {
        heading: '🐛 问题修复',
        items: [
          {
            title: 'CLI 会话不再显示错误的 token 数字',
            text: 'ACP 每轮只给一个累计用量，DSH 却按单次请求理解，速度和上下文占用都会被算错。现在不再上报，CLI 会话不显示 tok/s、token 用量和缓存命中。',
          },
          {
            title: 'CLI 启动失败时说明原因',
            text: '收集 CLI 的 stderr 末尾，失败信息附带最后 800 个字符和退出码；Windows 的无符号退出码同时给出有符号值。npm 的 `Could not read package.json` 会被认成安装不完整，并给出要删除的 `_npx/<hash>` 目录。',
          },
        ],
      },
      {
        heading: '📄 文档',
        items: [
          {
            text: 'README 补充 Worktree 的说明，以及 DSH 侧上下文压缩对 CLI 会话不生效的原因和替代做法。',
          },
          { text: '版本记录文件统一放到 `docs/release-notes/`。' },
        ],
      },
      {
        heading: '🔧 维护',
        items: [
          {
            text: '新增 Git worktree 的读取与创建、侧边栏分组和共享的 git POST；删除转发 token 用量的模块，各自带测试和 e2e。版本号升到 1.0.5。',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.4',
    date: '2026-11-09',
    sections: [
      {
        heading: '✨ 新功能',
        items: [
          {
            title: '每个模型独立的思考强度',
            text: '读取 CLI 报出的 `thought_level`，按模型记住可用等级，选中后随下一条消息发送。没见过的模型先用默认模型的等级，实际用到后再以 CLI 报的为准，并写入模型缓存。',
          },
          {
            title: '模型菜单显示厂商图标',
            text: '从模型 id 和名字识别 DeepSeek、Kimi、Claude、OpenAI，认不出时用 CLI 自己的图标，都没有就留空位让名字保持对齐。',
          },
          {
            title: '多厂商模型按厂商分组',
            text: 'OMP、PI、OpenCode 的模型 id 带 `vendor/` 前缀，出现两个及以上厂商时每个厂商一个分组；无前缀的行（含默认项）留在最上方，选中后仍发送完整 id。',
          },
          {
            title: 'PTC 模式可以用 CLI 了',
            text: 'CLI 的工具调用包成 `run_code` 程序执行，工具卡片显示为 `run_code`。单次调用（含等待审批）受 PTC 运行时超时上限约束，长任务建议切回标准模式；运行时不兼容时会在启动 CLI 前提示。',
          },
        ],
      },
      {
        heading: '🔧 改进',
        items: [
          {
            title: '模型菜单更干净',
            text: '不再列出与默认项同名的行，也不再列出同一家族里已被新版本取代的旧版本；已经用着这些模型的会话不受影响。',
          },
          {
            title: '思考强度不支持时给出提示',
            text: '切换模型后如果新模型不支持之前选的等级，沿用 CLI 当前的等级，并提示在菜单里重新选择，而不是让这条消息失败。',
          },
        ],
      },
      {
        heading: '📄 文档',
        items: [{ text: 'README 的标题、关键词和截图加入 Kimi CLI，PTC 模式说明改为已支持及其限制。' }],
      },
      {
        heading: '🔧 维护',
        items: [{ text: '版本号升到 1.0.4；新增思考强度、旧版本识别、PTC 包装和模型图标模块，各自带直接测试。' }],
      },
    ],
  },
  {
    version: '1.0.3',
    date: '2026-11-09',
    sections: [
      {
        heading: '🐛 问题修复',
        items: [
          {
            title: 'Windows 上 npx 系 CLI 起不来',
            text: 'Node.js 安装包自带的 `npx.cmd` 把路径存在变量里，插件之前解析不出来，Claude Code、Codex、Kimi、PI 都报「无法在不经过命令行的情况下启动 npx.cmd」。现在能认出这种写法，用旁边的 `node.exe`（或 `PATH` 里的 node）直接运行 `npx-cli.js`。',
          },
          {
            title: '升级提示',
            text: '之前为了绕过这个问题在 `cordis.patch.yml` 里改成 `cmd /c npx ...` 的，升级后可以删掉那段配置、恢复默认，否则收不到以后的适配器版本更新。',
          },
        ],
      },
    ],
  },
  {
    version: '1.0.2',
    date: '2026-11-08',
    sections: [
      {
        heading: '✨ 新功能',
        items: [
          {
            title: '设置页版本记录',
            text: 'CC GUI 设置新增「版本记录」页签：一个版本一页，用左右箭头或圆点翻看每个版本的更新说明，当前运行的版本会标出来。',
          },
          {
            title: '打包 Kimi CLI',
            text: 'Kimi Code 自带 `acp` 子命令，用固定版本 `npx -y @moonshot-ai/kimi-code@2.5.2 acp` 启动，不需要适配器；真实账号已验证。',
          },
          {
            title: '模型座位接管每个会话',
            text: 'CLI 会话列 CLI 自己的模型，其他会话只列 DSH 自己运行的提供方，旁边是推理等级菜单；同名的模型用说明或 id 区分。',
          },
          {
            title: 'CLI 会话上报 token 用量',
            text: '把 ACP 每次响应里的 usage 映射成 DSH 的 TokenUsage，CLI 会话也能显示速度和缓存命中。',
          },
          {
            title: '设置页提示新版本',
            text: '有更新的 Release 时，版本胶囊变成指向该 Release 说明的链接。',
          },
          {
            title: '切换器里 harness 只列一条',
            text: '所有非 CLI 提供方合并成一条「DeepSeek」，不再逐个列出。',
          },
        ],
      },
      {
        heading: '🐛 问题修复',
        items: [
          {
            title: 'Windows 上 `.cmd` 启动器起不来',
            text: '读出 shim 里的脚本和解释器直接运行；解释器不一定是 node，会沿 `PATH` 最多追 4 层。',
          },
          {
            title: 'macOS / Linux 从 Dock 启动时找不到 node',
            text: '启动时向登录 shell 读一次 `PATH`，读到之前补上常见安装目录，`npx` 系 CLI 不再以退出码 127 失败。',
          },
          {
            title: 'npx 缓存不完整时给出正确提示',
            text: '认出 `_npx` 缓存目录并提示删除后重试，而不是让用户重装。',
          },
        ],
      },
      {
        heading: '🔧 重构',
        items: [
          { text: '模型菜单拆出 `menu-models.ts` 和 `effort-menu.tsx`，渲染行为不变。' },
          { text: '切换器的内置项判断改为 `isBuiltInChoice`，设置页锁定与偏好清理共用同一套规则。' },
        ],
      },
      {
        heading: '📄 文档',
        items: [
          { text: '发版约定写进 AGENTS.md 与 README。' },
          { text: 'README 补充 Kimi CLI 的 Node.js 22.19 要求与登录步骤。' },
        ],
      },
    ],
  },
  {
    version: '1.0.1',
    date: '2026-11-08',
    sections: [
      {
        heading: '🐛 问题修复',
        items: [
          {
            title: '设置页 GitHub 链接指向错误的仓库',
            text: 'GitHub 胶囊原本打开 desktop-cc-gui，现在指向本插件仓库；测试改为从 `package.json` 读仓库地址，避免再次漂移。',
          },
        ],
      },
      {
        heading: '🔧 维护',
        items: [{ text: '发布改用 npm Trusted Publishing，靠 `release.yml` 的 OIDC 身份发布，不再保存令牌。' }],
      },
      {
        heading: '📄 文档',
        items: [{ text: 'README 调整功能表位置并更新包描述。' }],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-08',
    sections: [
      {
        heading: '✨ 新功能',
        items: [
          {
            title: '接入 Agent CLI',
            text: 'Claude Code、Codex CLI、PI CLI、OMP CLI、OpenCode、CodeBuddy CLI 经 ACP 注册成 DSH 的模型提供方，工具调用、审批和改动都走 DSH 原生界面。',
          },
          {
            title: 'CLI 与模型菜单',
            text: '输入框旁切换 CLI；模型菜单列出 CLI 真实可用的模型，会话中途换模型下一条消息生效。',
          },
          {
            title: '变更面板',
            text: '右侧栏把改动分成已暂存、未暂存、未跟踪，可以暂存、撤销、提交、推拉、切换分支，点开文件看行内 diff。',
          },
          {
            title: '启动脚本与终端',
            text: '会话标题栏保存常用命令，一键在终端标签里运行；标题栏的终端按钮开关右侧栏终端。',
          },
          {
            title: '文件和会话状态',
            text: '工作区文件右键「添加到对话」插入 `@路径`；会话列表显示所用 CLI 的图标和运行中的蓝点。',
          },
          {
            title: 'CC GUI 设置',
            text: 'CLI 菜单的顺序和开关、界面交互开关、更多功能预告都集中在一个设置页里。',
          },
        ],
      },
    ],
  },
]
