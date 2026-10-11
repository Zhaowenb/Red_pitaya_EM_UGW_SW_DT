/* Standalone, analysis-only pages have no access to the ADC/DAC task channel. */
(() => {
  document.getElementById('productBrandTitle').textContent='WaveGuard BTF';
  const home=document.createElement('a');home.className='rp-home';home.textContent='Red Pitaya 首页';home.title='返回 Red Pitaya 主菜单';
  home.href=['localhost','127.0.0.1','::1'].includes(location.hostname)?'/measure':`${location.protocol}//${location.hostname}/#`;
  home.target='_top';
  document.querySelector('.wg-header').append(home);
  WaveGuardUI.appearance({theme:localStorage.getItem('waveguard-ui-theme')||'dark'});
  if(document.getElementById('magControls')) {
    const note=document.createElement('p');note.className='rp-btf-note';note.textContent='Red Pitaya 仅有两路输入；本页三个通道均为模型预览，不是实测。本版不开放磁路诊断硬件启动。';
    document.getElementById('magControls').prepend(note);
  }
})();
