# 代码归档约定

仓库收录 software/red_pitaya 的软件代码，不含相邻 Pico 项目或板卡认证材料。

保留 app 构建布局和启动/部署入口。旧版未参与构建的控制器、WebSocket 前端和说明归入 archive/hann-v1；一次性移植脚本以 .py.txt 归入 archive/migrations，保留原文，避免作为当前升级脚本运行。

main.h 仍被当前菜单控制器引用；waveform.h 与 app/tests/test_waveform.cpp 仍用于 make test，不移走。

- app/data、部署 dist、node_modules、构建缓存及编译产物不上传。
- PPT、原始 NPZ/NPY、ZIP、设备 known_hosts、密钥与环境文件不上传；现有本地文件保留。
- 八组回环 JSON 指标报告上传，原始波形留在本地与板端。
- WaveGuard demo-capture.json 是原型运行资源，保留并标注来源。
- 不新指定统一许可证，第三方来源见 THIRD_PARTY_NOTICES。

tools/package-source.ps1 从 Git 已提交文件生成完整源码 ZIP；部署脚本只打包 app。

CI 运行 Python 回归、JS 语法检查和 WaveGuard 构建。六项 Pico 原实现对照需要额外提供相邻项目，独立仓库明确跳过。实机验收脚本不被 CI 自动运行。

## 2026-10-09 归档验证

- 原工作区：68 项 Python 回归通过，含 Pico 原实现对照（19.599 s）。
- 独立暂存副本：68 项发现，62 项通过、6 项可选 Pico 对照跳过（18.460 s）；未引用外部 Pico 源码。
- 当前前端全部 JS 和 PowerShell 脚本语法通过。
- WaveGuard TypeScript 与 Vite 生产构建通过；主 JS 包约 1.44 MB，构建提示大包，后续可按页面拆分。
- Pico 的 622 个基线文件 SHA-256 全部一致，没有修改。
- 暂存内容检查未发现常见私钥、GitHub token 或 AWS access key 格式；设备 known_hosts、原始数据和大型文件均已排除。
