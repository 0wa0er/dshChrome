# DeepSeek Harness Chrome 侧栏

连接已有的本地 DeepSeek Harness 桌面版，在 Chrome 原生侧栏聊天、选择本地项目，并将网页选中文字加入对话上下文。

## 当前开发版

- 默认使用插件管理的私有目录 `$DSH_HOME/chrome/default-project`，不创建普通项目列表项。
- 右键“添加到 DeepSeek 对话”，或在侧栏点击添加选中文字；多段引用可预览、移除，发送时才交给模型。
- 按项目保留输入草稿、引用和当前会话，支持历史、生成状态和停止。
- 两端有状态检测、握手、配套安装和修复接口。首次浏览器安装需要用户确认。

兼容性目标是当前安装版 dsh `0.2.1-rc.3`、Windows 和支持 Side Panel API 的 Chrome。此包不包含 API Key，沿用现有 dsh 的配置。

## 安装开发版

发布文件在 `dist` 中。解压 `dsh-chrome-0.1.0-windows.zip`，**先完全退出 DeepSeek Harness**，再双击 `windows-install.cmd`。安装程序将：

1. 使用已有桌面版的命令入口安装同包内的 dsh 插件，不安装第二份 dsh。
2. 准备本机桥接并注册到当前 Windows 用户，限定此扩展的稳定 ID。
3. 显示扩展目录；重新启动 dsh 后，在 Chrome 的 `chrome://extensions/` 中加载该目录。

Chrome 最后的“加载已解压的扩展程序”需用户操作。扩展目录为 `$DSH_HOME/chrome/companion/0.1.0/extension`（未设置 DSH_HOME 时在用户 `.dsh` 目录下）。首次连接成功前，安装状态不会标记为已就绪。

也可从源码测试：`npm test`、`npm run check`，然后 `npm pack --pack-destination dist`。`node install/cli.js setup --dry-run` 只展示注册计划；不带 `--dry-run` 才写入当前用户的桥接注册。已通过其他入口安装 dsh 插件时，可运行这条命令注册源码目录的桥接，再加载源码中的 `extension` 目录。

通用 npm 版 `dsh` 可能拒绝管理桌面版 profile；本包安装程序使用已安装桌面版自带的 CLI。安装时若 dsh 仍在运行会停止并提示退出，不会强制关闭正在进行的任务。

## 从 Chrome 开始

扩展检测到宿主缺失时提供配套安装入口。正式商店页和安装程序下载地址尚未发布，因此本开发版使用同一 ZIP 中的安装程序，不提供虚构下载链接。安装程序运行后会自动安装 dsh 端与桥接；浏览器只需恢复连接。

`release.json` 预留 `webStoreUrl`、`installerUrl`。发布后这两个固定入口承接双向安装。扩展不能在本机宿主未安装时直接运行本机命令；操作系统与 Chrome 的安装确认会保留。

## 使用

打开侧栏，连接状态变为“已连接”后选择“默认”或已有本地项目。选中文字后使用右键菜单添加，引用先保存在当前项目草稿中。可连续添加多段，最后输入问题并发送。

切换项目不会移动原会话。断线或发送结果未知时草稿会保留，先点击“检查发送状态”；插件不会自动重发。dsh 请求工具权限或提问时，需在 dsh 对应会话中处理。

选区上限为 20,000 字符，每份草稿最多 20 段。浏览器内部页面及无访问权限的框架可能无法读取选区；右键失败打开侧栏时引用仍会保留，扩展图标会提示用户手动打开。

## 卸载与排错

运行 `node install/cli.js status` 检查当前用户桥接注册；`node install/cli.js unregister` 仅注销本机桥接，不删除工作目录或会话。dsh 插件需通过桌面 CLI 的 `plugin --profile desktop remove dsh-chrome` 移除并重启。

常见问题：dsh 尚未重启以加载新插件、Chrome 仍加载旧目录、桥接清单指向已移动的源码目录，或两端协议不兼容。使用同一版本包重新运行安装程序修复；不需要关闭 dsh 原有认证。

实际运行验证记录见 `docs/verification.md`；自动测试通过不代表 Chrome 和真实 dsh 的人工联调已经完成。
