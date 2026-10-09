# Hann Burst Scope 历史说明（归档前快照，不作为当前使用说明）

当前版本采用 Pico 四页面＋独立 Python 分析服务＋C++ 硬件进程。
请先阅读 [v2 使用与部署说明](MIGRATION.md) 和 [功能对照、验证记录](docs/verification.md)。

**2026-09-18：v2 已原位部署到 192.168.10.68，ARM 构建、菜单唯一入口、分尺寸图标、Web/硬件服务和停止后重启均通过。**
旧应用备份为 `/opt/redpitaya/hann_scope_backups/20260918-005657`。尚未发起真实 ADC/DAC 采集；DDR、幅值和时序仍需接线后的低幅值验收。

以下保留原第一版说明，仅供旧版本回溯；其中幅值定义、采样率、单通道限制不适用于 v2。
原文另存于 `README-v1.md`。

---

# Hann Burst Scope — Red Pitaya 第一版（历史）

这是一个运行在 Red Pitaya 本机上的原生 Web App：OUT1 输出归一化 Hann 窗正弦 tone burst，IN1 由 AWG 硬件触发并记录触发后的 10 ms 信号。页面同时显示采集波形、理论波形和主要系统状态。

## 已针对的硬件环境

- Red Pitaya STEMlab 125-14-Z7020 Pro v2.0
- Zynq 7020、1 GB RAM
- Red Pitaya OS 2.07 build 48
- 标准 `v0.94` oscilloscope/generator FPGA overlay
- 板卡地址：`192.168.10.68`

本应用使用板载 C/C++ API，不需要开启 SCPI server，也不占用 TCP 5000 端口。

## 信号定义

离散 AWG 缓冲区包含一个完整 tone burst：

```text
x(t) = A × Hann(t / Tb) × sin(2π f t)
Tb   = cycles / f
```

Hann 与正弦的乘积会按离散样本峰值归一化，因此页面输入的幅值 `A` 表示理论波形的实际峰值。默认参数为：

- 载波频率：80 kHz
- 周期数：5
- 峰值幅度：0.10 V
- burst 时长：62.5 µs
- ADC 记录：10 ms

## 采集参数

- ADC 基准采样率：125 MS/s
- 抽取系数：80
- 有效采样率：1.5625 MS/s
- 10 ms 样本数：15,625
- ADC 触发源：`RP_TRIG_SRC_AWG_PE`
- 后触发样本：15,625（API 中心偏移参数为 7,433）
- 输入量程：LV（±1 V 满量程）

普通采集缓冲区为 16,384 点。抽取 80 后，15,625 点恰好覆盖 10 ms 并保留约 759 点余量。当前频率上限限制为 500 kHz；默认 80 kHz 每周期约有 19.5 个 ADC 样本。

## 文件结构

```text
app/
├── index.html             页面结构
├── css/app.css            页面样式
├── js/app.js              WebSocket、绘图、CSV 导出
├── js/pako.js             Red Pitaya 帧解压
├── info/info.json         应用菜单信息
├── fpga.sh                加载标准 v0.94 overlay
├── fpga.conf              旧版兼容配置
├── Makefile
├── src/
│   ├── main.cpp           DAC、ADC、触发和系统状态
│   ├── main.h
│   ├── waveform.h         Hann tone burst 纯函数
│   └── Makefile
└── tests/test_waveform.cpp
```

## 部署

在 Windows PowerShell 中运行：

```powershell
Set-Location F:\Project\01guided_waves\software\red_pitaya
.\deploy.ps1
```

脚本会提示输入 SSH 密码，不会保存密码。它将源文件安装到：

```text
/opt/redpitaya/www/apps/hann_scope
```

并直接在 ARM 板卡上构建 `controllerhf.so`。安装后刷新 `http://192.168.10.68/`，从应用列表打开 **Hann Burst Scope**。

板载 OS 2.07-48 的 SDK 头文件使用 C++20 类型，应用因此按 `-std=c++20` 构建。

部署使用项目内的 `.redpitaya_known_hosts` 固定当前板卡 ED25519 主机密钥，不会修改用户目录中的 SSH `known_hosts`。当前核验指纹为：

```text
SHA256:U+C6u7+ULiGWzH5r/t8DcLBTO/qkwdMP/tSeVvr6VZs
```

## 板上测试

部署脚本会构建应用。纯波形单元测试可以另外运行：

```bash
cd /opt/redpitaya/www/apps/hann_scope
make test
```

前端 JavaScript 可在开发电脑上检查语法：

```powershell
node --check .\app\js\app.js
```

## 首次硬件联调

1. 暂时不要连接执行器或功率放大器。
2. 用合适的 SMA 同轴线将 OUT1 直接连接到 IN1。
3. 打开 Hann Burst Scope。
4. 保持默认 80 kHz、5 周期、0.10 V。
5. 点击“发射并采集”。
6. 核对 IN1 波形、峰值、触发起点和理论波形。
7. 完成低幅值闭环检查后，再逐步提高幅值。

注意：Gen 2 的 RF 输出规格与负载有关（±1 V @ 50 Ω、±2 V @ Hi-Z）。IN1 是高阻输入，首次联调必须从 0.10 V 开始，并以页面显示的 ADC 实测峰值为准。

## 安全行为

- 页面加载不会自动输出。
- 每次点击只输出一个 burst。
- 即使 burst 长于 10 ms，也会自然完成后再关闭 OUT1；ADC 仍只保存起始 10 ms。
- ADC 在 DAC 触发前先布防。
- 采集完成、超时、应用退出时都会关闭 OUT1。
- 页面离开时会发送关闭 OUT1 命令。
- 幅值输入被限制在 0～0.9 V。
- 硬件访问失败或触发超时会在页面显示具体状态。

不要同时运行 Red Pitaya 的 Oscilloscope、Spectrum Analyzer、SCPI server 或其他占用采集/发生器 FPGA 的应用。

## 第一版限制

- 只使用 OUT1 和 IN1。
- 固定记录 10 ms。
- 固定使用 LV 输入量程和 80 倍抽取。
- 不使用 DDR Deep Memory；如需完整观察 1 MHz 以上信号，应升级为 AXI DMA 采集。
- “立即关闭 OUT1”由 WebSocket 控制线程处理；正常测量只有约 25 ms，但在底层驱动阻塞时不能替代物理断电保护。
