/* Red Pitaya adaptations for the September Pico workflows. Local assets only. */
const rpThreeChannelLimit = '三路同步采集需要 Voltage Monitor、Current Monitor 和 Receiver；本板仅有 IN1/IN2。请在 LCR 数据分析页导入历史归档。';
$('rpExcitation').parentElement.id='rpExcitationControl';
function rpElement(id){return $(id)||(lcrModeRecords||[]).map(record=>record.node.id===id?record.node:record.node.querySelector('#'+id)).find(Boolean);}
function rpOptions(id, values, fallback) {
  const element=rpElement(id); if(!element)return;
  const previous=element.value;
  element.replaceChildren(...values.map(value=>new Option(value==='A'?'IN1 (A)':value==='B'?'IN2 (B)':`±${value}`,value)));
  element.value=values.includes(previous)?previous:fallback;
}
for(const name of channelNames){
  if(!'AB'.includes(name)) $('ch'+name).closest('.channel-card').hidden=true;
  else {
    rpOptions('chRange'+name,['1V','20V'],'1V');
    $('ch'+name).closest('label').querySelector('span').textContent=name==='A'?'IN1 (A)':'IN2 (B)';
  }
}
for(const id of ['lcrVoltageChannel','lcrCurrentChannel','bigLcrVoltageChannel','bigLcrCurrentChannel'])
  rpOptions(id,['A','B'],id.includes('Voltage')?'A':'B');
for(const id of ['lcrVoltageRange','lcrCurrentRange','bigLcrVoltageRange','bigLcrCurrentRange'])
  rpOptions(id,['1V','20V'],'1V');
for(const id of ['lcrSampleRate','bigLcrSampleRate']) {
  rpElement(id).max='125';
}
$('sampleRate').max='125';
$('awgBufferSamples').value='16384'; $('awgBufferSamples').disabled=true;
rpElement('bigLcrAutoRange').checked=false; rpElement('bigLcrAutoRange').disabled=true;
rpElement('bigLcrAutoRange').parentElement.lastChild.textContent='固定 LV/HV 量程（必须与物理跳线一致；不支持自动切换）';
const rangeNote=rpElement('bigLcrAutoRange').parentElement.nextElementSibling;
rangeNote.textContent='IN1 / IN2 各自选择 ±1 V 或 ±20 V，配置须与板上跳线一致。溢出会停止测量，软件不会自动改量程重发。';
for(const id of ['simulate','lcrSimulate','bigLcrSimulate']) rpElement(id).checked=false;
if(['localhost','127.0.0.1','::1'].includes(location.hostname)){$('rpHome').href='/measure';$('rpHome').textContent='⌂ 本机首页';}

const lcrConnection=document.createElement('section');
lcrConnection.className='panel page-only rp-lcr-connection'; lcrConnection.dataset.pages='lcr';
lcrConnection.innerHTML='<h2>Red Pitaya 接线</h2><p>电压与电流监测同时占用 IN1 / IN2；波形输出使用下方选定端口。LCR 激励参数独立于实时测量页。</p><div class="form-grid"><label>激励端口<select id="rpLcrOutput"><option value="out1">OUT1</option><option value="out2">OUT2</option></select></label><label>负载参考<select id="rpLcrLoad"><option value="Hi-Z">高阻 Hi-Z</option><option value="50ohm">50 Ω</option></select></label><label>触发方式<select id="rpLcrTrigger"><option value="internal">内部 AWG 同步</option><option value="analog">所选 Monitor 边沿</option></select></label></div><p>软件检测的疑似跳闸不等于读取到功放保护状态。</p>';
document.querySelector('.control-stack').prepend(lcrConnection);
function rpValidateRate(rate,total){
  const dec=Math.round(125e6/rate);
  if(!Number.isFinite(rate)||rate<=0||(![1,2,4,8].includes(dec)&&(dec<16||dec>65536)))throw Error('不支持的采样率：抽取须为 1/2/4/8 或 16–65536');
  const actual=125e6/dec;
  if(Math.abs(actual-rate)>rate*1e-6)throw Error(`请求采样率无法精确实现；最近合法值 ${(actual/1e6).toPrecision(8)} MS/s`);
  if(!Number.isFinite(total)||total<32||total>2e6)throw Error('每通道记录必须在 32–2,000,000 点之间');
}
const rpBasePayload=buildPayload;
buildPayload=function(){const result=rpBasePayload();rpValidateRate(result.sample_rate_hz,result.pre_trigger_samples+result.post_trigger_samples);return result;};
const rpAwgPayload=buildAwgPayload;
buildAwgPayload=function(){return {...rpAwgPayload(),buffer_samples:16384,custom_csv:$('customCsvPath').value.trim()||null};};
function rpLcrPayload(payload){
  const cfg=payload.config;
  cfg.redpitaya={mode:$('rpLcrOutput').value,load:$('rpLcrLoad').value,trigger_source:$('rpLcrTrigger').value,
    roles:{A:'monitor',B:'monitor'},output2:{},phase1_deg:0,phase2_deg:0};
  cfg.awg.buffer_samples=16384;
  rpValidateRate(cfg.sample_rate_hz,cfg.pre_trigger_samples+cfg.post_trigger_samples);
  if(payload.big_lcr) {payload.big_lcr.auto_monitor_range=false;payload.big_lcr.auto_range_max_retries=0;}
  return payload;
}
const rpSmallPayload=buildLcrPayload, rpBigPayload=buildBigLcrPayload;
buildLcrPayload=function(){return rpLcrPayload(rpSmallPayload());};
buildBigLcrPayload=function(){return rpLcrPayload(rpBigPayload());};
buildLinearityPayload=function(){throw Error(rpThreeChannelLimit);};
rpElement('linearityStartBtn').textContent='三路同步采集：本板不支持';
rpElement('linearityStartBtn').title=rpThreeChannelLimit;
const limitation=document.createElement('p');limitation.className='wiring-note';limitation.textContent=rpThreeChannelLimit;
rpElement('linearityStartBtn').parentElement.before(limitation);
const legacyPanel=rpElement('linearityStartBtn').closest('section');
legacyPanel.classList.add('rp-unsupported');
const legacyNotice=document.createElement('p');legacyNotice.className='rp-limit-notice';legacyNotice.textContent=rpThreeChannelLimit;
legacyPanel.prepend(legacyNotice);
rpElement('linearityMeasurementResult').classList.add('rp-unsupported-result');

const rpResult=updateResult;
updateResult=function(result,reset=true){
  rpResult(result,reset);
  const s=result.summary, id=s.excitation_id||'legacy';
  $('modeText').textContent=`${s.simulated?'仿真数据 · 未访问硬件':'Red Pitaya 实测'} · ${id}`;
  for(const opt of $('rpExcitation').options)opt.disabled=!(s.available_excitations||[id]).includes(opt.value);
  $('rpExcitation').value=id;
};
const rpSummary=updateCapturePlanSummary;
updateCapturePlanSummary=function(){try{const p=captureSampleCounts();rpValidateRate(p.sampleRateMsps*1e6,p.total);rpSummary();$('capturePlanSummary').classList.remove('invalid');}catch(e){$('capturePlanSummary').textContent=e.message;$('capturePlanSummary').classList.add('invalid');}};
updateCapturePlanSummary();
const rpPreview=drawAwgPreview;
const previewOutput=document.createElement('select');previewOutput.id='rpPreviewOutput';previewOutput.setAttribute('aria-label','输出参考预览端口');
previewOutput.innerHTML='<option value="1">OUT1 输出参考</option><option value="2">OUT2 输出参考</option>';
$('awgPreviewMeta').before(previewOutput);previewOutput.addEventListener('change',scheduleAwgPreview);
updateAwgPreview=async function(){const requestId=++previewRequest;try{
  const output=previewOutput.value, payload={...buildAwgPayload()};
  if(output==='2')Object.assign(payload,JSON.parse($('rpOutput2').value||'{}'));
  payload.phase_deg=Number($('rpPhase'+output).value);
  const preview=await api('/api/awg-preview',{method:'POST',body:JSON.stringify(payload)});
  if(requestId!==previewRequest)return;
  preview.output=output;drawAwgPreview(preview);
}catch(error){if(requestId===previewRequest)$('awgPreviewMeta').textContent=error.message;}};
drawAwgPreview=function(preview){rpPreview(preview);$('awgPreviewMeta').textContent+=` · OUT${preview.output||1} · ${preview.phase_deg||0}° · ${$('awgEnabled').checked?'输出参考（非实测）':'已禁用 · 参数预览'} · 负载端 ${preview.vpk} Vpk`;
  if($('rpLoad').value==='50ohm')$('awgPreviewMeta').textContent+=` · 设备侧 ${preview.vpk*2} Vpk`;};
syncHardwareControls();scheduleAwgPreview();
const interferenceLink=document.createElement('a');interferenceLink.href='/interference';interferenceLink.textContent='干扰排查';interferenceLink.className='rp-home';toolbar.append(interferenceLink);
const rpUploaded=$('rpUpload').onchange;
$('rpUpload').onchange=async function(event){await rpUploaded(event);const path=$('rpFilePath').value;if(path)document.querySelectorAll('#bigFolderDirectory,#smallFolderDirectory,#linearityDirectory').forEach(el=>el.value=path);};
// Local startup is explicit: the UI never silently substitutes simulation data.
api('/api/system').then(state=>{if(!state.hardware_connected)$('modeText').textContent='本机开发 · 板卡未连接（测试请勾选仿真）';}).catch(()=>{});
