/* BTF presentation only. Acquisition safety also lives in server preflight. */
(() => {
  const find=id=>document.getElementById(id);
  find('productBrandTitle').textContent='WaveGuard BTF';
  document.title='WaveGuard BTF · Red Pitaya';
  const status=document.createElement('span');status.className='rp-btf-status';status.textContent='IN1 / IN2 · 125-14 Pro';
  document.querySelector('.wg-header').append(status);
  const panel=WaveGuardUI.getStage('measure');
  if(panel)panel.inspector.append(boardSection);
  const note=document.createElement('p');note.className='rp-btf-note';
  note.textContent='偏置扫描：PZT + 一路可选激励监测。两路 ADC 不能同时测 PZT、电压、电流；三路波形保护与 ADC 自动量程不可用。板卡温度不是线圈温度。';
  find('biasChannel').parentElement.before(note);
  for(const id of ['biasChannel','biasExcVoltage','biasExcCurrent']) {
    const field=find(id),optional=id!=='biasChannel',previous=field.value;
    field.replaceChildren(...(optional?[new Option('不启用','')]:[]),new Option('IN1 (A)','A'),new Option('IN2 (B)','B'));
    field.value=['A','B'].includes(previous)?previous:optional?'':'A';
  }
  const port=document.createElement('label');port.textContent='偏置扫描激励端口';
  port.innerHTML+='<select id="rpBiasOutput"><option value="out1">OUT1</option><option value="out2">OUT2</option></select>';
  find('biasSnapshot').parentElement.before(port);
  const original=buildPayload;
  buildPayload=function(){const cfg=original();if(document.body.dataset.page==='bias-scan') {
    cfg.redpitaya.mode=find('rpBiasOutput').value;cfg.redpitaya.output2={};
    // Global roles do not override task-specific PZT/monitor assignments.
    for(const channel of 'AB') {const enabled=channel===find('biasChannel').value||channel===find('biasExcVoltage').value||channel===find('biasExcCurrent').value;
      cfg.channels[channel].enabled=enabled;cfg.redpitaya.roles[channel]=!enabled?'disabled':channel===find('biasChannel').value?'receiver':'monitor';}
  } return cfg;};
  function limits(){for(const id of ['biasGuard','biasAutoRange']){find(id).checked=false;find(id).disabled=true;find(id).title='本板不具备三路 ADC 或自动量程';}
    rpElement('linearityStartBtn').disabled=true;rpElement('bigLcrAutoRange').disabled=true;}
  limits();window.addEventListener('waveguard-status',()=>queueMicrotask(limits));
  if(!localStorage.getItem('redpitaya-btf-bias-settings')) {
    for(const id of ['biasAmplitudeFixed','biasAmplitudeStart','biasAmplitudeStop'])find(id).value='0.1';
    find('biasAmplitudeStep').value='0.1';
  }
  find('biasMemory').max='256';
  const baseMode=find('modeText');const observer=new MutationObserver(()=>{status.textContent=baseMode.textContent||'IN1 / IN2 · 125-14 Pro';});observer.observe(baseMode,{subtree:true,childList:true,characterData:true});
  find('rpHome').href=['localhost','127.0.0.1','::1'].includes(location.hostname)?'/measure':`${location.protocol}//${location.hostname}/#`;
})();
