# Red Pitaya EM / UGW Studio

面向 **STEMlab 125-14 Pro Z7020 Gen2** 的激励、采集、导波分析和阻抗测量软件。板端应用沿用 **Hann Burst Scope** 名称与 `hann_scope` 菜单入口。

当前维护版本为 `app/`：Python + NumPy 负责分析、扫描和存储，独立 C++ 服务独占 ADC/DAC，网页使用离线 HTML/CSS/JavaScript。`waveguard-studio/` 是独立 React 演示原型，带 DEMO DATA 标识。

## 功能与硬件边界

| 功能 | 当前实现 |
|---|---|
| 激励 | 正弦、方波、三角、Hann、消振、爬升保持、平顶 LCR、CSV；Vpp、偏置、频率、周期、相位 |
| 双输出 | OUT1、OUT2、轮流、同步起发；独立 OUT2 参数；同频载波固定相位差 |
| 采集 | IN1/IN2；触发与预触发；默认 5 MS/s、50,000 点、10 ms；DDR 深存储 |
| 扫描 | 频率、周期、二维、重复；停止保留数据；N/f 分窗、SNR、拖尾、稳定时间和排名 |
| 单数据分析 | 游标、缩放和平移、零相位带通、FFT/PSD、STFT/WPD/CWT、多时间窗、派生导出 |
| 归档 | NPZ、CSV+JSON、ZIP；逐次读取、重算、热图、推荐；原始记录保留 |
| LCR | 小信号复数校准、大信号频率×Vpp 扫描、暂停恢复、阻抗/谐波/线性度归档分析 |
| 实验性分析 | 双通道空间—时间对称性保留 TEST；Pico 三通道历史文件可分析 |
| 系统状态 | 型号、温度、负载、内存、存储、运行时间、任务状态 |

现场只有两路 ADC；Pico A～H 是历史数据兼容性。LV/HV 由物理跳线设置，不提供软件自动切换。需要三路独立 Monitor/Receiver 的新采集明确拒绝。

Hann 相位直接写入载波样本，包络保持固定；不同频率不会维持固定相位差。CSV 相位表示整段循环移位。两路输出参考预览不替代 IN1/IN2 实测。

## 目录

```text
app/                    当前板端应用、分析、硬件服务、网页与图标
tests/                  仿真、HTTP、算法和相位回归
tools/                  实机验收与源码打包
docs/                   使用、移植差异、验收和维护说明
archive/hann-v1/         旧版控制器及 WebSocket 前端
archive/migrations/      一次性移植记录
waveguard-studio/        React + Vite 演示原型与锁定依赖
.github/workflows/      独立仓库测试与原型构建
```

采集数据、部署 ZIP、依赖、二进制、SSH 主机记录及 PPT 不进入 Git；现有本地文件保留。轻量实测 JSON 报告上传，原始 NPZ 留在本地，参见 [归档说明](docs/ARCHIVE.md)。

## 本机运行

需要 Python 3.10+：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r app/requirements.txt
.\start-local.ps1 -PythonExe .\.venv\Scripts\python.exe
```

访问 `http://127.0.0.1:4825/measure`，本机测试显式选择仿真。跨平台可在 `app` 目录运行 `python -m redscope.server --host 127.0.0.1 --port 4825`。

## 部署

```powershell
.\deploy-v2.ps1 -Device 192.168.10.68 -User root
```

需要 OpenSSH、tar 和 SSH 登录权限。交互认证不保存密码；首次连接需核验板卡 SSH 主机指纹。支持 `-IdentityFile`、`-KnownHostsFile` 和 `-Rollback`。

在板上编译、备份后原位替换 `/opt/redpitaya/www/apps/hann_scope`。数据位于 `/home/redpitaya/hann_scope_data`。HTTP 入口是 `http://<device>/hann_scope/`，不是 `/apps/hann_scope/`。

已验证 **OS 2.07-48、Python 3.10.12、标准 v0.94 FPGA**。OS 3.00 尚未验收；重刷 SD 卡前备份程序、服务和数据，并在新版重新编译验证。

## 验证

```powershell
$env:PYTHONPATH = Join-Path $PWD 'app'
python -m unittest discover -s tests -v
node --check app/web/app.js
node --check app/web/board.js
node --check app/web/port.js
```

独立仓库可运行自身测试。六项 Pico 原实现对照仅在相邻 `Pico_4824A` 项目存在时运行，缺少则明确跳过。Pico 源码不属于此仓库，也不被测试修改。

2026-09-28 实机完成八组 0.1 Vpp、零偏置双路回环：正弦/Hann 的 0°、90°、180°、−90°，每组两路各 50,000 点、5 MS/s、10 ms，无溢出，并修复 DDR 页对齐。详见 [实机记录](docs/BOARD_ACCEPTANCE_20260928.md)。这不代表全部功能已通过实机验收。

随后修正的发射结果切换竞态通过本机测试，尚未写入当次已验收板卡。详见 [版本状态](docs/STATUS.md)。

## 演示原型

```bash
cd waveguard-studio
npm ci
npm run dev
```

已包含浏览器演示数据，首次启动无需 Pico 原始文件。`npm run data` 是可选提取操作，见 [原型说明](waveguard-studio/README.md)。

更多文档：[索引](docs/README.md) · [移植说明](MIGRATION.md) · [第三方说明](THIRD_PARTY_NOTICES.md)。本次归档不新指定统一源码许可证。
