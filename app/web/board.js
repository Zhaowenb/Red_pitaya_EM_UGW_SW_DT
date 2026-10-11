/* Hardware-specific controls around the ported BTF analysis workflow. */
const boardDefaults={mode:'alternating',trigger_source:'internal',load:'Hi-Z',phase1_deg:0,phase2_deg:0,roles:{A:'receiver',B:'receiver'},output2:{}};
let boardSettings; try {boardSettings={...boardDefaults,...JSON.parse(localStorage.getItem('hann-scope-btf-board')||'{}')};} catch {boardSettings=boardDefaults;}
const boardSection=document.createElement('div'); boardSection.className='rp-board-settings';
boardSection.innerHTML=`<div class="subhead"><span>板端接线与激励</span><small>A=IN1 · B=IN2</small></div><div class="form-grid">
<label>激励方式<select id="rpMode"><option value="alternating">OUT1 / OUT2 轮流</option><option value="simultaneous">OUT1 + OUT2 同步</option><option value="out1">仅 OUT1</option><option value="out2">仅 OUT2</option></select></label>
<label>输出负载参考<select id="rpLoad"><option value="Hi-Z">高阻 Hi-Z</option><option value="50ohm">50 Ω</option></select></label>
<label>触发方式<select id="rpTrigger"><option value="internal">内部 AWG 硬件触发</option><option value="analog">输入通道边沿</option><option value="external">外部边沿</option></select></label>
<label>触发方向<select id="rpDirection"><option value="rising">上升沿</option><option value="falling">下降沿</option></select></label>
${['A','B'].map((c,i)=>`<label>IN${i+1} 角色<select id="rpRole${c}"><option value="receiver">接收</option><option value="monitor">发射监测</option><option value="disabled">禁用</option></select></label>`).join('')}
<label>OUT1 载波相位 °<input id="rpPhase1" type="number" value="0" min="-180" max="180"></label><label>OUT2 载波相位 °<input id="rpPhase2" type="number" value="0" min="-180" max="180"></label></div>
<p class="wiring-note">同步表示同一时刻起发，并非同相。两路同频时，相位差 = OUT2 − OUT1；Hann 包络不移动。不同频率不会保持固定相位差；自定义 CSV 的相位表示整段循环移位。</p>
<details class="rp-output-editor"><summary>OUT2 独立波形参数</summary><p>默认继承 OUT1。JSON 可覆盖 waveform、pk_to_pk_v、offset_v、cycles、frequency_hz 和消振/保持参数；扫描时两路频率和周期联动。</p><textarea id="rpOutput2" aria-label="OUT2 参数 JSON">{}</textarea></details>
<label>自定义波形 CSV 板端路径<input id="customCsvPath" placeholder="先在上方上传 CSV，再粘贴返回路径"></label><p class="wiring-note">软件量程须与 LV(±1V) / HV(±20V) 物理跳线一致。DAC 曲线为输出参考；实测监测须占用 IN1 或 IN2。</p>`;
$('channels').after(boardSection);
$('inputRange').innerHTML='<option>1V</option><option>20V</option>';
$('waveform').add(new Option('自定义 CSV','custom'));
$('awgBufferSamples').value='16384';
for(const option of [...$('triggerSource').options]) if(!'AB'.includes(option.value)) option.remove();
const homeLink=document.createElement('a');homeLink.id='rpHome';homeLink.className='rp-home';homeLink.textContent='Red Pitaya 首页';homeLink.title='返回 Red Pitaya 主菜单';
homeLink.href=`${location.protocol}//${location.hostname}/#`;
homeLink.target='_top';
document.querySelector('.wg-header').append(homeLink);
const toolbar=document.createElement('div'); toolbar.className='rp-tools';
toolbar.innerHTML=`<label>${rpIcon('upload')}导入文件 / 扫描 ZIP<input id="rpUpload" type="file" accept=".npz,.csv,.json,.zip"></label><input id="rpFilePath" aria-label="板端文件路径" placeholder="板端路径"><button id="rpDownload">${rpIcon('download')}下载文件 / 归档</button><button id="rpBrowse">${rpIcon('archive')}浏览数据</button><button id="rpCancelAnalysis">${rpIcon('stop')}取消分析</button><small id="rpJobStatus"></small><span class="rp-telemetry" id="rpSystem">正在读取板端状态…</span><label>当前发射<select id="rpExcitation"><option value="OUT1">OUT1</option><option value="OUT2">OUT2</option><option value="OUT1+OUT2">同步</option><option value="legacy">历史数据</option></select></label>`;
toolbar.id='rpTools';toolbar.hidden=true;
document.body.append(toolbar);
const toolsButton=document.createElement('button');toolsButton.type='button';toolsButton.className='wg-icon-button';toolsButton.innerHTML=rpIcon('archive');toolsButton.title='文件、系统与任务';toolsButton.setAttribute('aria-label','文件、系统与任务');
document.querySelector('.wg-header').append(toolsButton);
const toolsPanel=WaveGuardUI.panelController({panel:toolbar,trigger:toolsButton});
toolsButton.onclick=()=>toolsPanel.set(!toolsPanel.isOpen());
$('rpMode').value=boardSettings.mode; $('rpLoad').value=boardSettings.load; $('rpTrigger').value=boardSettings.trigger_source;
$('rpPhase1').value=boardSettings.phase1_deg; $('rpPhase2').value=boardSettings.phase2_deg;
$('rpOutput2').value=JSON.stringify(boardSettings.output2,null,2);
for(const c of 'AB') $('rpRole'+c).value=boardSettings.roles[c];
function syncHardwareControls(){
 const enabled=$('triggerEnabled').checked, source=$('rpTrigger').value;
 $('triggerSource').disabled=!enabled||source!=='analog';
 $('triggerLevel').disabled=!enabled||source!=='analog';
 $('rpDirection').disabled=!enabled||source==='internal';
 $('triggerTimeout').disabled=!enabled;
 const fifty=$('rpLoad').value==='50ohm';
 $('awgVpp').max=fifty?'1.8':'3.6';
 $('awgOffset').min=fifty?'-.9':'-1.8'; $('awgOffset').max=fifty?'.9':'1.8';
 const note=$('triggerWiringNote');
 if(note) note.lastChild.textContent=source==='internal'
  ? ' OUT1 / OUT2 与 ADC 由板内 AWG 触发同步，不需要输入回接作为触发源。'
  : source==='external' ? ' 使用板卡 EXT 触发输入；ADC 与已启用 DAC 将等待同一外部边沿，请确认电平制式与极性。'
  : ' 选择 IN1 或 IN2 的接收边沿触发，并设置安全阈值。';
}
function enforceRoles(){
 for(const c of channelNames){
  if(!'AB'.includes(c)){ $('ch'+c).checked=false; $('ch'+c).disabled=true; continue; }
  const role=$('rpRole'+c).value; $('ch'+c).checked=role!=='disabled'; $('ch'+c).disabled=true;
  $('sweepRx'+c).checked=role==='receiver';
 }
 $('sweepTransmitterChannel').value=['A','B'].find(c=>$('rpRole'+c).value==='monitor')||'NONE';
 syncSweepReceiverChannels();
}
const originalPayload=buildPayload;
buildPayload=function(){
 enforceRoles(); const payload=originalPayload();
 const output2=JSON.parse($('rpOutput2').value||'{}');
 if(!output2||Array.isArray(output2)||typeof output2!=='object') throw new Error('OUT2 参数应为 JSON 对象');
 payload.redpitaya={mode:$('rpMode').value,trigger_source:$('rpTrigger').value,load:$('rpLoad').value,
  phase1_deg:Number($('rpPhase1').value),phase2_deg:Number($('rpPhase2').value),roles:{A:$('rpRoleA').value,B:$('rpRoleB').value},output2};
 payload.trigger.direction=$('rpDirection').value;
 payload.capture_timeout_s=Math.max(.1,Number($('triggerTimeout').value)/1000)+Number($('captureDurationUs').value)/1e6;
 localStorage.setItem('hann-scope-btf-board',JSON.stringify(payload.redpitaya)); return payload;
};
boardSection.addEventListener('change',()=>{enforceRoles();syncHardwareControls();scheduleAwgPreview();try{buildPayload();}catch(error){setEvent(error.message,'error');}});
$('triggerEnabled').addEventListener('change',syncHardwareControls);
enforceRoles();
syncHardwareControls();
$('rpUpload').onchange=async event=>{try{
 const files=Array.from(event.target.files); if(!files.length)return;
 const batch=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
 let primary;
 for(const file of files){
 const response=await fetch('/api/upload',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name),'X-Upload-Batch':batch},body:file});
 const result=await response.json(); if(!response.ok)throw new Error(result.error);
 if(!file.name.endsWith('.json')||result.kind==='calibration') primary=result;
 }
 const result=primary; if(!result){setEvent('元数据已上传；请选择 CSV 和同名 JSON 一起上传','complete');return;}
 $('rpFilePath').value=result.path; $('analysisPath').value=result.path; $('archivePath').value=result.path;
 if(result.kind==='calibration'&&$('lcrCalibrationFile')) await refreshLcrCalibrations(result.path);
 if(result.path.endsWith('.csv')) $('customCsvPath').value=result.path;
 setEvent('已上传：'+result.path,'complete');
}catch(error){setEvent(error.message,'error');}};
$('rpUpload').multiple=true;
$('rpDownload').onclick=()=>{const path=$('rpFilePath').value.trim();if(path)location.href='/api/download?path='+encodeURIComponent(path);else setEvent('请选择或上传文件，或填写板端归档路径','error');};
$('rpBrowse').onclick=()=>{showPage('file-analysis',true); $('analysisPath').value=window.rpDataRoot||'';if(window.WaveGuardFiles)WaveGuardFiles.open($('analysisPath'),'file');};
$('rpCancelAnalysis').onclick=()=>api('/api/jobs/cancel',{method:'POST',body:'{}'}).catch(error=>setEvent(error.message,'error'));
const originalApi=api;
// Board HTTP is not a secure context; randomUUID is not available there.
const controlClient=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
api=async function(path,options={}){
 options.headers={'Content-Type':'application/json',...options.headers,'X-Hann-Client':controlClient};
 const result=await originalApi(path,options);
 if(path==='/api/result/display'&&result.summary) $('modeText').textContent=`${result.summary.simulated?'仿真数据 · 未访问硬件':'Red Pitaya 实测'} · ${result.summary.excitation_id||''}`;
 if(result.path) $('rpFilePath').value=result.path;
 if(result.directory) $('rpFilePath').value=result.directory;
 if(result.report_path) $('rpFilePath').value=result.report_path;
 if(path==='/api/status'&&result.task_kind==='capture'&&result.capture_files?.length) $('rpFilePath').value=result.capture_files[0];
 // Keep the selected output dimension out of other outputs' heatmaps and ranks.
 const summaryKey=Array.isArray(result.summary_rows)?'summary_rows':'summary';
 const runsKey=Array.isArray(result.run_rows)?'run_rows':'runs';
 if((path.startsWith('/api/sweep/')||path.startsWith('/api/analysis/sweep-'))&&Array.isArray(result[summaryKey])) {
  const ids=[...new Set(result[summaryKey].map(r=>r.excitation_id||'legacy'))];
  for(const option of $('rpExcitation').options)option.disabled=!ids.includes(option.value);
  if(!ids.includes($('rpExcitation').value)) $('rpExcitation').value=ids[0];
  const selected=$('rpExcitation').value;
  result[summaryKey]=result[summaryKey].filter(r=>(r.excitation_id||'legacy')===selected);
  if(result[runsKey])result[runsKey]=result[runsKey].filter(r=>(r.excitation_id||'legacy')===selected);
  if('points' in result)result.points=result[summaryKey].length;
  if('run_count' in result)result.run_count=result[runsKey]?.length||0;
  if('runs_completed' in result)result.runs_completed=result[runsKey]?.length||0;
 }
 return result;
};
$('rpExcitation').onchange=async()=>{try{
 const page=document.body.dataset.page;
 if(page==='measure'){latestResult=await api('/api/result?excitation='+encodeURIComponent($('rpExcitation').value));updateResult(latestResult);}
 else if(page==='sweep'){latestSweep=await api('/api/sweep/result');updateSweepResult(latestSweep);drawSweepResult();}
 else if(page==='sweep-analysis') await loadSweepArchive($('archivePath').value.trim());
}catch(error){
 if(document.body.dataset.page==='measure'&&latestResult?.summary?.excitation_id)$('rpExcitation').value=latestResult.summary.excitation_id;
 setEvent(error.message,'error');
}};
function fmt(value,unit=''){return value==null?'—':Number(value).toFixed(1)+unit;}
async function refreshBoard(){try{
 const state=await api('/api/system'); $('rpSystem').textContent=`${state.hardware_connected?'硬件已连接':'硬件未连接'} · ${fmt(state.temperature_c,'°C')} · 1 min负载 ${fmt(state.cpu_load_1m)} · 内存 ${fmt(state.memory_used_percent,'%')} · 磁盘 ${fmt(state.storage_used_percent,'%')}`;
 $('rpJobStatus').textContent=window.activeAnalysisJob?'分析计算中…':'';
}catch{$('rpSystem').textContent='板端服务断开';}}
api('/api/capabilities').then(result=>{
 window.rpDataRoot=result.data_root;
 const referencePath=value=>!value.trim()||/(^|[\\/])Pico_4824A(?:_btf)?([\\/]|$)/i.test(value);
 if(referencePath($('analysisPath').value))$('analysisPath').value=result.data_root;
 if(referencePath($('archivePath').value))$('archivePath').value=result.data_root+'/sweeps';
}).catch(error=>setEvent(error.message,'error'));
refreshBoard();setInterval(refreshBoard,3000);
const emergencyStop=document.createElement('button');
emergencyStop.innerHTML=rpIcon('stop')+'停止硬件任务';
emergencyStop.onclick=()=>api('/api/stop',{method:'POST',body:'{}'}).catch(error=>setEvent(error.message,'error'));
toolbar.append(emergencyStop);
const systemDetails=document.createElement('button');systemDetails.innerHTML=rpIcon('connect')+'系统详情';toolbar.append(systemDetails);
const systemDialog=document.createElement('dialog');systemDialog.className='rp-system-dialog';
systemDialog.innerHTML='<h2>设备与任务状态</h2><p>未知项目保持未核验，不使用模拟遥测填充。</p><pre></pre><form method="dialog"><button>关闭</button></form>';
document.body.append(systemDialog);
systemDetails.onclick=async()=>{try{
 const state=await api('/api/system');
 systemDialog.querySelector('pre').textContent=JSON.stringify(state,null,2);systemDialog.showModal();
}catch(error){setEvent(error.message,'error');}};
setInterval(()=>fetch('/api/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:controlClient})}).catch(()=>{}),3000);
// Reattach to a task after a refresh, retaining the original Pico polling UI.
api('/api/status').then(status=>{if(['running','paused'].includes(status.state)){pollStatus();if(!polling)polling=setInterval(pollStatus,350);}else if(status.state==='complete'||status.state==='stopped'){pollStatus();}}).catch(()=>{});
window.addEventListener('pagehide',()=>fetch('/api/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:controlClient}),keepalive:true}).catch(()=>{}));
