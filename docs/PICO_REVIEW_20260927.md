# 4824A 源码移植时发现的问题（只记录，未修改源目录）

检查对象：`software/Pico_4824A`，2026-09-27 工作区版本。以下结论来自静态代码检查和移植回归；不代表对 Pico 实机做过验证。

## 1. 小信号 LCR 未排除溢出记录

`pico4824a/lcr.py` 的 `analyze_impedance()` 直接对输入做相量拟合，未检查 `CaptureResult.overflow_channels`。`execute_lcr()` 保存采集后仍调用该函数，因此已标记溢出的电压/电流记录也可能进入阻抗结果或标准电阻校准。

建议：保存原始数据后拒绝这两路的溢出记录，并提示调整量程。Red Pitaya 副本已增加此检查；Pico 源文件未改。

## 2. 仿真校准与实机校准缺少隔离

`write_resistor_calibration()` 和 `_calibration_signature()` 未保存或检查仿真来源；Web 的校准列表包含相同目录里的所有校准。参数一致时，模拟生成的校准因子可能被实机任务使用。

建议：校准记录保留 `simulated`，运行前校验来源。Red Pitaya 副本已记录并拒绝混用，同时把输出端口、负载和相位纳入设备校准签名。

## 3. 单文件加载与缩放会增加计算请求

`web/app.js` 中 `loadSelectedAnalysisFile()` 在初次 `/api/analysis/process` 后再次执行 `refreshAnalysis()`；`installAnalysisCanvasInteraction()` 在缩放/平移后调度计算。对桌面电脑影响可能较小，但会放大 ARM 板端延迟。

Red Pitaya 保留已有的全时段缓存与本地缩放实现；滤波、通道和频谱参数变化仍会提交计算请求。

## 4. 可移植性限制，不是 Pico 缺陷

- 三路同步线性度、三路干扰实验不能在仅两个 ADC 的板卡上等价运行。Red Pitaya 保留历史归档分析，采集入口明确标记不支持。
- Pico 软件量程切换不能映射为 Red Pitaya 的 LV/HV 物理跳线切换。
- 小信号归档里的校准路径是原机器绝对路径。跨机器重算时必须同时携带校准文件；缺少文件应明确报错，不能静默取消校准。
- Pico 目录中的本地启动/USB 会话逻辑不应复制为 Red Pitaya 硬件已连接或已归零的证明。

本文件位于 Red Pitaya 项目，未对 4824A 目录应用任何修复。
