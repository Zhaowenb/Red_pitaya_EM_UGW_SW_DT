# v2 使用与部署

2026-09-27 本机新增 LCR、复数校准、大信号扫描及归档分析，尚未部署板卡。参见 [本机增量移植说明](docs/LOCAL_PORT_20260927.md) 和 [4824A 源码问题记录](docs/PICO_REVIEW_20260927.md)。本机可运行 `./start-local.ps1`。

沿用 `hann_scope` 应用ID和 `/opt/redpitaya/www/apps/hann_scope`，不添加第二入口。
Pico 原项目未修改。保留实时测量、参数扫描、单数据分析、参数数据分析四页操作习惯。

## 结构

- `app/web/`：四页 UI、离线操作 SVG、favicon。
- `app/redscope/`：Python HTTP服务、NumPy分析、扫描、文件传输。
- `app/src/hardware.cpp`：官方API独占进程，通过本机Unix socket收发任务和波形。
- `app/src/controller.cpp`：原菜单入口的服务启停代理，不直接访问ADC/DAC。
- `app/services/`：硬件、Web及统一生命周期的systemd单元。
- `app/info/icon.svg`、`icon.png`：波包＋回波图标，PNG为256px；favicon为32px。
- `deploy-v2.ps1`：分阶段构建、备份、原位升级；旧 `deploy.ps1` 转入此流程。
- `app/rollback-board.sh`：恢复应用和服务，不回滚/删除数据。

## 本地验证

Python≥3.10、NumPy≥1.21，不需要PicoSDK。

```powershell
cd F:\Project\01guided_waves\software\red_pitaya
python -m unittest discover -s tests -v
cd app
python -m redscope.server --host 127.0.0.1 --port 4825
```

访问 `http://127.0.0.1:4825/measure` 并打开“仿真”。本机服务不会通过网络代替板卡发射。
本机数据位于 `app/data`，部署包不包含它。

## 原位升级与回退

先确认SSH登录可用，退出其他访问ADC/DAC的应用。
部署脚本不会主动运行采集任务或发射信号。

```powershell
.\deploy-v2.ps1 -Device 192.168.10.68 -IdentityFile 'C:\path\to\your-key'
# 或省略 IdentityFile，在自己的终端交互输入 SSH 密码；勿把密码写进脚本或聊天
.\deploy-v2.ps1 -Device 192.168.10.68
# 回退
.\deploy-v2.ps1 -Device 192.168.10.68 -IdentityFile 'C:\path\to\your-key' -Rollback
```

先在 `/tmp/hann_scope-stage-*` 检查Python/NumPy及API、构建程序，再备份旧应用和服务。
依赖/构建失败会在替换前中止，不自行联网安装系统包。安装中失败会尝试恢复原文件。
首开原菜单入口后由Bazaar加载官方 `v0.94` FPGA并启动服务。

数据在 `/home/redpitaya/hann_scope_data`，备份在 `/opt/redpitaya/hann_scope_backups/<时间戳>`。
旧应用data复制到独立目录，原始备份仍保留。回退不删除既有测量数据。
入口仍为 `http://192.168.10.68/hann_scope/`。
脚本已于2026-09-18在 `192.168.10.68` 执行：ARM构建、备份、原位替换、菜单入口、图标、服务停止/重启通过。尚未实际执行回退，也未发起ADC/DAC采集。

## 硬件与信号含义

- A=IN1、B=IN2；历史A–H文件按原通道完整分析。
- 默认OUT1、OUT2轮流，各保存IN1/IN2，四路径来自两次记录，不是四路同步输入。
- 同步模式保存两路联合响应，不能称为已分离的独立路径。
- 通道角色：接收、发射监测、禁用；监测通道不进入接收排名。
- 默认73.7kHz、7周期、0.1Vpp；Vpk=Vpp/2。OUT2默认继承，可用JSON独立覆盖。
- API显式采用Hi-Z幅值参考；50Ω按分压换算。实际幅值/相位仍待板端校验。
- 软件保守限制 |偏置|+Vpk≤1.8V（Hi-Z）/0.9V（50Ω），不代表外部功放/换能器安全范围。
- 任意波形固定16384点，避免短缓冲改变实际频率。
- 默认5MS/s、10ms、50000点，超普通缓冲走AXI DDR；不可用则报错，不截短记录。
- 采样率必须能由125MHz合法抽取精确得到；显示请求和实际值，不静默换档。
- LV/HV必须与物理跳线匹配；只支持DC、零模拟偏置。
- 饱和提示由接近量程的样本值估算，不是独立硬件过载传感器。
- 超时关闭输出并报错，不复用Pico“自动触发后继续采集”的回退行为。

## 文件、任务和限制

- 上传NPZ、CSV＋JSON、扫描ZIP；CSV和同名JSON支持一次多选，下载CSV自动打包同名JSON。
- 路径限定数据根目录；ZIP拒绝穿越、符号链接和非数据文件；禁止pickle。
- 上传128MiB、ZIP展开512MiB、单NPZ展开192MiB上限。
- 一个硬件任务、一个分析进程。当前分析忙碌会拒绝额外任务，不是多任务排队调度器。
- Linux分析地址空间默认640MiB；STFT逐窗/CWT逐频率保留展示数据。
- 每次扫描落盘并检查余量。停止后保留已完成记录。
- 关闭发起任务的页面请求停止；心跳失联超过20秒停止。后台节流也可能触发此保护。
- 刷新读取任务状态；服务重启不自动续发射，扫描通过归档页恢复。
- 派生滤波文件使用唯一后缀，重新评价另存 `derived/reevaluation_*.json`。
- 系统未知字段不填模拟值，时钟锁定当前标记“未核验”。
- 服务面向可信实验室局域网，无互联网级登录认证，不要直接暴露到公网。

## 官方参考

- [信号发生器API](https://redpitaya.readthedocs.io/en/latest/appsFeatures/remoteControl/command_list/commands-gen.html)
- [负载和幅值实现](https://github.com/RedPitaya/RedPitaya/blob/master/rp-api/api/src/gen_handler.cpp)
- [深存储示例](https://redpitaya.readthedocs.io/en/latest/appsFeatures/examples/DMM/deepMemoryAcq.html)

以板卡实际安装API与实测为最终准绳。
