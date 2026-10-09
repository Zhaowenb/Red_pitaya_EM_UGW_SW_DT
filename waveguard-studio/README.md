# WaveGuard Studio

面向 Red Pitaya STEMlab 125-14 Pro Z7020 Gen2 与 2 m 拉线棒的导波检测前端原型。

## 本地运行

```powershell
npm ci
npm run dev
```

默认访问 `http://localhost:5173/`。生产构建使用：

仓库已包含 `src/demo-capture.json`，首次启动无需 `npm run data`；该命令用于可选重新提取。此目录是演示原型，不属于 hann_scope 硬件部署包。

```powershell
npm run build
npm run preview
```

构建产物位于 `dist/`，资源采用相对路径，可复制到 Red Pitaya 的静态应用目录中。当前版本不会修改或调用既有 Red Pitaya 后端。

## 演示数据

`scripts/extract_demo_data.py` 从 Pico 项目最近两份 `capture_*.npz` 中提取 900 点浏览器演示波形：

- `capture_20260723_154019.npz`：演示基线
- `capture_20260723_154838.npz`：演示当前状态

保留 5 MHz、73.7 kHz、7 周期及原始通道波形形态。当前通道语义按最近一次 Pico 扫频配置重新整理：

- `H → TX-A`：发射监测 / 触发参考
- `F → RX-A`：第一接收通道
- `G → RX-B`：第二接收通道
- `TX-B`：为展示未来双激励架构，由 TX-A 确定性移相、缩放得到，并在界面标记 `DEMO DERIVED`

位置估计采用同端脉冲回波比例法。当前演示数据得到接收首波约 101.4 μs、候选反射约 303.4 μs、2 m 端面反射约 815.1 μs，对应距传感端约 0.57 m。网页中的健康状态属于确定性的前端演示逻辑，不代表真实缺陷标定或寿命预测。

## 页面

- 起始页：实时绘制的暗色波场与答辩开场主视觉
- 总览：同端双激励 / 双接收几何、传播方向与比例定位
- 导波实验：Hann 参数、10 ms 采集、TX / RX 四轨示波
- 单次分析：TX 有效性、RX 回波窗、共/差分量与时频图
- 参数研究：频率 × 周期热图、推荐工作点、选中波形
- 健康档案：状态分布、趋势、基线对比与答辩截图导出

所有页面均持续显示 `DEMO DATA / 原型演示` 标记，并为未来 `RedPitayaProvider` 数据接口保留替换位置。
