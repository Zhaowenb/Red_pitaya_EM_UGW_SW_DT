(function () {
    'use strict';

    const APP_ID = 'hann_scope';
    const previewMode = new URLSearchParams(window.location.search).has('preview');
    const STATUS = {
        0: ['准备就绪', 'idle'],
        1: ['ADC 已布防', 'running'],
        2: ['正在采集', 'running'],
        3: ['采集完成', 'complete'],
        4: ['发生错误', 'error'],
        5: ['输出已停止', 'idle']
    };

    const state = {
        ws: null,
        reconnectTimer: null,
        connecting: false,
        parameters: {},
        adc: [],
        expected: [],
        sampleRate: 1562500,
        captureMs: 10,
        cursorRatio: null,
        drawPending: false,
        initializedFromBoard: false
    };

    const byId = (id) => document.getElementById(id);
    const elements = {};

    function cacheElements() {
        [
            'connection-pill', 'control-form', 'frequency-khz', 'cycles', 'amplitude-v',
            'burst-duration', 'run-button', 'stop-button', 'status-dot', 'status-title',
            'status-text', 'adc-peak', 'adc-rms', 'sample-rate', 'decimation',
            'waveform-canvas', 'cursor-readout', 'trace-summary', 'export-button',
            'temperature', 'temperature-note', 'load-average', 'memory-used',
            'disk-used', 'uptime', 'model-name', 'os-version'
        ].forEach((id) => { elements[id] = byId(id); });
    }

    function setConnection(kind, text) {
        const pill = elements['connection-pill'];
        pill.className = `pill ${kind}`;
        pill.querySelector('b').textContent = text;
        elements['run-button'].disabled = kind !== 'online';
    }

    function scheduleReconnect() {
        window.clearTimeout(state.reconnectTimer);
        // The FPGA overlay briefly drops the socket while the application is
        // starting. Reconnect to the existing controller instead of calling
        // Bazaar again, which would restart it and create a reconnect loop.
        state.reconnectTimer = window.setTimeout(connectWebSocket, 1500);
    }

    async function startApplication() {
        if (state.connecting || (state.ws && state.ws.readyState === WebSocket.OPEN)) return;
        state.connecting = true;
        setConnection('offline', '正在启动应用');
        try {
            const response = await fetch(`/bazaar?start=${APP_ID}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (result.status !== 'OK') throw new Error(result.reason || '应用启动失败');
            connectWebSocket();
        } catch (error) {
            state.connecting = false;
            // Loading the FPGA overlay can close the HTTP startup request even
            // though the application was started successfully. Probe WS first.
            setConnection('offline', '等待实时通道');
            elements['status-text'].textContent = error.message;
            connectWebSocket();
        }
    }

    function connectWebSocket() {
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
        const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${scheme}://${window.location.hostname}:9002`);
        ws.binaryType = 'arraybuffer';
        state.ws = ws;

        ws.onopen = () => {
            state.connecting = false;
            window.clearTimeout(state.reconnectTimer);
            setConnection('online', '板卡已连接');
        };
        ws.onclose = () => {
            state.connecting = false;
            setConnection('offline', '连接已断开');
            scheduleReconnect();
        };
        ws.onerror = () => setConnection('error', '通信错误');
        ws.onmessage = (event) => {
            try {
                const payload = decodeFrame(event.data);
                processPayload(payload);
            } catch (error) {
                console.error('Unable to decode Red Pitaya frame', error);
            }
        };
    }

    function decodeFrame(data) {
        if (typeof data === 'string') return JSON.parse(data);
        let bytes = new Uint8Array(data);
        const prefix = bytes.length >= 4
            ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
            : '';

        // controllerhf frames use a four-byte Red Pitaya protocol marker:
        // EZIA = gzip JSON, NZIA = plain JSON. Binary signal markers are not
        // expected because this application publishes ordinary CFloatSignal data.
        if (prefix === 'EZIA' || prefix === 'NZIA') {
            bytes = bytes.slice(4);
            if (prefix === 'EZIA') bytes = window.pako.inflate(bytes);
        } else {
            // Retain compatibility with older images that sent raw JSON or gzip.
            const startsWithJson = bytes[0] === 0x7b || bytes[0] === 0x5b;
            if (!startsWithJson) bytes = window.pako.inflate(bytes);
        }

        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    }

    function processPayload(payload) {
        if (payload.parameters) updateParameters(payload.parameters);
        if (payload.signals) updateSignals(payload.signals);
    }

    function parameterValue(node) {
        return node && Object.prototype.hasOwnProperty.call(node, 'value') ? node.value : undefined;
    }

    function updateParameters(parameters) {
        Object.keys(parameters).forEach((name) => {
            state.parameters[name] = parameterValue(parameters[name]);
        });

        if (!state.initializedFromBoard && state.parameters.FREQUENCY_HZ !== undefined) {
            elements['frequency-khz'].value = formatNumber(state.parameters.FREQUENCY_HZ / 1000, 3);
            elements.cycles.value = state.parameters.CYCLES;
            elements['amplitude-v'].value = formatNumber(state.parameters.AMPLITUDE_V, 3);
            state.initializedFromBoard = true;
            updateComputedBurst();
        }

        if (state.parameters.SAMPLE_RATE_HZ) state.sampleRate = Number(state.parameters.SAMPLE_RATE_HZ);
        if (state.parameters.CAPTURE_MS) state.captureMs = Number(state.parameters.CAPTURE_MS);

        updateMeasurementStatus();
        updateTelemetryCards();
    }

    function updateSignals(signals) {
        if (signals.ADC_TRACE && Array.isArray(signals.ADC_TRACE.value)) {
            state.adc = signals.ADC_TRACE.value.slice();
        }
        if (signals.EXPECTED_TRACE && Array.isArray(signals.EXPECTED_TRACE.value)) {
            state.expected = signals.EXPECTED_TRACE.value.slice();
        }
        if (state.adc.length > 1) {
            elements['export-button'].disabled = false;
            elements['trace-summary'].textContent = `${state.adc.length.toLocaleString()} 点 · IN1 · 触发后 10 ms`;
        }
        scheduleDraw();
    }

    function updateMeasurementStatus() {
        const code = Number(state.parameters.STATUS_CODE || 0);
        const definition = STATUS[code] || STATUS[0];
        elements['status-title'].textContent = definition[0];
        elements['status-dot'].className = `status-dot ${definition[1]}`;
        elements['status-text'].textContent = state.parameters.STATUS_TEXT || 'Ready';
        elements['run-button'].disabled = !state.ws || state.ws.readyState !== WebSocket.OPEN || code === 1 || code === 2;
        elements['adc-peak'].textContent = formatVoltage(state.parameters.ADC_PEAK_V);
        elements['adc-rms'].textContent = formatVoltage(state.parameters.ADC_RMS_V);
        elements['sample-rate'].textContent = formatRate(state.parameters.SAMPLE_RATE_HZ);
        elements.decimation.textContent = state.parameters.DECIMATION ? `×${state.parameters.DECIMATION}` : '—';
        if (state.parameters.BURST_US !== undefined) {
            elements['burst-duration'].textContent = formatDurationUs(state.parameters.BURST_US);
        }
    }

    function updateTelemetryCards() {
        const temp = Number(state.parameters.TEMPERATURE_C);
        elements.temperature.textContent = Number.isFinite(temp) ? `${temp.toFixed(1)} °C` : '—';
        const tempCard = elements.temperature.closest('.temperature-card');
        tempCard.classList.toggle('warm', temp >= 70 && temp < 80);
        tempCard.classList.toggle('hot', temp >= 80);
        elements['temperature-note'].textContent = temp >= 80 ? '接近 85 °C 保护点' : 'Zynq XADC';
        elements['load-average'].textContent = finiteText(state.parameters.LOAD_1M, 2);
        elements['memory-used'].textContent = percentText(state.parameters.MEMORY_USED_PCT);
        elements['disk-used'].textContent = percentText(state.parameters.DISK_USED_PCT);
        elements.uptime.textContent = formatUptime(state.parameters.UPTIME_S);
        elements['model-name'].textContent = state.parameters.MODEL_NAME || '—';
        elements['os-version'].textContent = state.parameters.OS_VERSION || '—';
    }

    function readControls() {
        const frequencyKHz = Number(elements['frequency-khz'].value);
        const cycles = Math.round(Number(elements.cycles.value));
        const amplitude = Number(elements['amplitude-v'].value);
        if (!Number.isFinite(frequencyKHz) || frequencyKHz < 1 || frequencyKHz > 500) {
            throw new Error('载波频率必须在 1–500 kHz 之间');
        }
        if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100) {
            throw new Error('周期数必须是 1–100 的整数');
        }
        if (!Number.isFinite(amplitude) || amplitude < 0 || amplitude > 0.9) {
            throw new Error('峰值幅度必须在 0–0.9 V 之间');
        }
        return { frequencyHz: frequencyKHz * 1000, cycles, amplitude };
    }

    function sendParameters(values) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            throw new Error('板卡尚未连接');
        }
        const parameters = {};
        Object.keys(values).forEach((name) => { parameters[name] = { value: values[name] }; });
        state.ws.send(JSON.stringify({ parameters }));
    }

    function runMeasurement(event) {
        event.preventDefault();
        try {
            const controls = readControls();
            sendParameters({
                FREQUENCY_HZ: controls.frequencyHz,
                CYCLES: controls.cycles,
                AMPLITUDE_V: controls.amplitude,
                RUN: 1
            });
            elements['status-title'].textContent = '命令已发送';
            elements['status-text'].textContent = '等待 ADC 布防';
            elements['status-dot'].className = 'status-dot running';
            elements['run-button'].disabled = true;
        } catch (error) {
            elements['status-title'].textContent = '参数错误';
            elements['status-text'].textContent = error.message;
            elements['status-dot'].className = 'status-dot error';
        }
    }

    function stopOutput() {
        try {
            sendParameters({ STOP: 1 });
        } catch (error) {
            elements['status-text'].textContent = error.message;
        }
    }

    function updateComputedBurst() {
        try {
            const controls = readControls();
            const durationUs = 1e6 * controls.cycles / controls.frequencyHz;
            elements['burst-duration'].textContent = formatDurationUs(durationUs);
            if (state.adc.length <= 1) buildPreview(controls);
        } catch (_) {
            elements['burst-duration'].textContent = '—';
        }
    }

    function buildPreview(controls) {
        const points = 15625;
        const sampleRate = 1562500;
        const duration = controls.cycles / controls.frequencyHz;
        const raw = new Array(4096);
        let rawPeak = 0;
        for (let i = 0; i < raw.length; i += 1) {
            const phase = i / (raw.length - 1);
            raw[i] = 0.5 * (1 - Math.cos(2 * Math.PI * phase)) * Math.sin(2 * Math.PI * controls.cycles * phase);
            rawPeak = Math.max(rawPeak, Math.abs(raw[i]));
        }
        state.expected = new Array(points).fill(0).map((_, i) => {
            const time = i / sampleRate;
            if (time > duration) return 0;
            const phase = time / duration;
            return controls.amplitude * 0.5 * (1 - Math.cos(2 * Math.PI * phase)) *
                Math.sin(2 * Math.PI * controls.frequencyHz * time) / rawPeak;
        });
        state.sampleRate = sampleRate;
        scheduleDraw();
    }

    function scheduleDraw() {
        if (state.drawPending) return;
        state.drawPending = true;
        window.requestAnimationFrame(() => {
            state.drawPending = false;
            drawChart();
        });
    }

    function drawChart() {
        const canvas = elements['waveform-canvas'];
        const rect = canvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const width = Math.max(320, Math.round(rect.width));
        const height = Math.max(280, Math.round(rect.height));
        if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
            canvas.width = width * ratio;
            canvas.height = height * ratio;
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const margin = { left: 56, right: 18, top: 22, bottom: 36 };
        const plot = {
            x: margin.left,
            y: margin.top,
            w: width - margin.left - margin.right,
            h: height - margin.top - margin.bottom
        };
        const adc = state.adc.length > 1 ? state.adc : [];
        const expected = state.expected.length > 1 ? state.expected : [];
        const sampleCount = Math.max(adc.length, expected.length, 2);
        const durationMs = 1000 * (sampleCount - 1) / state.sampleRate;
        let peak = 0.05;
        [adc, expected].forEach((series) => {
            for (let i = 0; i < series.length; i += 1) {
                const value = Number(series[i]);
                if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
            }
        });
        peak *= 1.16;

        ctx.fillStyle = '#0c1117';
        ctx.fillRect(0, 0, width, height);
        ctx.font = '10px system-ui, sans-serif';
        ctx.lineWidth = 1;

        for (let i = 0; i <= 5; i += 1) {
            const x = plot.x + plot.w * i / 5;
            ctx.strokeStyle = i === 0 || i === 5 ? '#303b49' : '#222b36';
            ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
            ctx.fillStyle = '#718094';
            ctx.textAlign = i === 0 ? 'left' : (i === 5 ? 'right' : 'center');
            ctx.fillText(`${(durationMs * i / 5).toFixed(2)}`, x, plot.y + plot.h + 22);
        }
        for (let i = 0; i <= 4; i += 1) {
            const y = plot.y + plot.h * i / 4;
            ctx.strokeStyle = i === 2 ? '#3b4756' : '#222b36';
            ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
            ctx.fillStyle = '#718094';
            ctx.textAlign = 'right';
            ctx.fillText((peak * (1 - i / 2)).toFixed(2), plot.x - 9, y + 3);
        }

        drawSeries(ctx, expected, plot, peak, '#50d2c2', 1.3, [5, 4]);
        drawSeries(ctx, adc, plot, peak, '#ff6b35', 1.45, []);

        if (state.cursorRatio !== null) {
            const x = plot.x + plot.w * state.cursorRatio;
            ctx.strokeStyle = 'rgba(237,242,247,.55)';
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
            ctx.setLineDash([]);
            const source = adc.length ? adc : expected;
            const index = Math.min(source.length - 1, Math.max(0, Math.round(state.cursorRatio * (source.length - 1))));
            const timeMs = 1000 * index / state.sampleRate;
            const measured = adc.length ? Number(adc[Math.min(index, adc.length - 1)]) : NaN;
            const ideal = expected.length ? Number(expected[Math.min(index, expected.length - 1)]) : NaN;
            elements['cursor-readout'].textContent = `${timeMs.toFixed(4)} ms  ·  IN1 ${numberOrDash(measured, 4)} V  ·  理论 ${numberOrDash(ideal, 4)} V`;
        }
    }

    function drawSeries(ctx, data, plot, peak, color, lineWidth, dash) {
        if (!data || data.length < 2) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y, plot.w, plot.h);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash(dash);
        ctx.beginPath();

        const columns = Math.max(1, Math.floor(plot.w));
        if (data.length <= columns * 2) {
            for (let i = 0; i < data.length; i += 1) {
                const x = plot.x + plot.w * i / (data.length - 1);
                const y = plot.y + plot.h * (0.5 - Number(data[i]) / (2 * peak));
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
        } else {
            for (let column = 0; column < columns; column += 1) {
                const start = Math.floor(column * data.length / columns);
                const end = Math.max(start + 1, Math.floor((column + 1) * data.length / columns));
                let min = Infinity;
                let max = -Infinity;
                for (let i = start; i < end; i += 1) {
                    const value = Number(data[i]);
                    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
                }
                if (!Number.isFinite(min)) continue;
                const x = plot.x + column;
                ctx.moveTo(x, plot.y + plot.h * (0.5 - min / (2 * peak)));
                ctx.lineTo(x, plot.y + plot.h * (0.5 - max / (2 * peak)));
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    function updateCursor(event) {
        const rect = elements['waveform-canvas'].getBoundingClientRect();
        const left = 56;
        const right = 18;
        state.cursorRatio = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / (rect.width - left - right)));
        scheduleDraw();
    }

    function clearCursor() {
        state.cursorRatio = null;
        elements['cursor-readout'].textContent = '移动鼠标查看采样点';
        scheduleDraw();
    }

    function exportCsv() {
        if (state.adc.length < 2) return;
        const rows = ['time_s,adc_v,expected_v'];
        for (let i = 0; i < state.adc.length; i += 1) {
            const expected = i < state.expected.length ? state.expected[i] : '';
            rows.push(`${(i / state.sampleRate).toFixed(9)},${Number(state.adc[i]).toFixed(8)},${expected === '' ? '' : Number(expected).toFixed(8)}`);
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `hann_scope_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    function formatNumber(value, digits) {
        return String(Number(Number(value).toFixed(digits)));
    }
    function finiteText(value, digits) {
        const number = Number(value);
        return Number.isFinite(number) ? number.toFixed(digits) : '—';
    }
    function percentText(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `${number.toFixed(1)}%` : '—';
    }
    function numberOrDash(value, digits) {
        return Number.isFinite(value) ? value.toFixed(digits) : '—';
    }
    function formatVoltage(value) {
        const number = Number(value);
        return Number.isFinite(number) ? `${number.toFixed(4)} V` : '—';
    }
    function formatRate(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return '—';
        return number >= 1e6 ? `${(number / 1e6).toFixed(4)} MS/s` : `${(number / 1e3).toFixed(2)} kS/s`;
    }
    function formatDurationUs(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '—';
        return number >= 1000 ? `${(number / 1000).toFixed(3)} ms` : `${number.toFixed(2)} µs`;
    }
    function formatUptime(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 0) return '—';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
    }

    function initialize() {
        cacheElements();
        elements['control-form'].addEventListener('submit', runMeasurement);
        elements['stop-button'].addEventListener('click', stopOutput);
        elements['export-button'].addEventListener('click', exportCsv);
        ['frequency-khz', 'cycles', 'amplitude-v'].forEach((id) => {
            elements[id].addEventListener('input', updateComputedBurst);
        });
        elements['waveform-canvas'].addEventListener('pointermove', updateCursor);
        elements['waveform-canvas'].addEventListener('pointerleave', clearCursor);
        new ResizeObserver(scheduleDraw).observe(elements['waveform-canvas']);
        window.addEventListener('pagehide', () => {
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ parameters: { STOP: { value: 1 } } }));
            }
        });
        updateComputedBurst();
        if (previewMode) {
            setConnection('offline', '离线预览');
            updateParameters({
                STATUS_CODE: { value: 0 },
                STATUS_TEXT: { value: '页面预览模式；不会访问硬件' },
                SAMPLE_RATE_HZ: { value: 1562500 },
                DECIMATION: { value: 80 },
                CAPTURE_MS: { value: 10 },
                TEMPERATURE_C: { value: 48.2 },
                LOAD_1M: { value: 0.18 },
                MEMORY_USED_PCT: { value: 31.4 },
                DISK_USED_PCT: { value: 22.7 },
                UPTIME_S: { value: 7342 },
                MODEL_NAME: { value: 'STEMlab 125-14-Z7020 Pro v2.0' },
                OS_VERSION: { value: '2.07 build 48' }
            });
            elements['run-button'].disabled = true;
        } else {
            startApplication();
        }
    }

    window.addEventListener('DOMContentLoaded', initialize);
}());
