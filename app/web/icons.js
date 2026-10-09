/* Local SVG icons. No font/CDN/network dependency. */
const rpIconPaths = {
 scope:'M2 12h4l2-7 4 14 3-11 2 4h5', sweep:'M3 19V5m0 14h18M6 15l4-7 5 5 5-9',
 lcr:'M2 12h3c0-9 4-9 4 0s4 9 4 0 4-9 4 0h5',
 analysis:'M3 3h12v18H3zM7 7h4M7 11h4M17 8l4 4-4 4', archive:'M3 5h18v4H3zM5 9v12h14V9M9 13h6',
 play:'M7 4l13 8-13 8z', stop:'M5 5h14v14H5z', save:'M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8',
 upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
 reset:'M3 10a9 9 0 1 1 1 8M3 3v7h7', filter:'M3 4h18l-7 8v8l-4-2v-6z',
 zoom:'M15 15l6 6M10 7v6m-3-3h6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0', connect:'M8 3v6m8-6v6M5 9h14v3a7 7 0 0 1-14 0zM12 19v3'
};
function rpIcon(name) { return `<svg class="rp-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${rpIconPaths[name] || rpIconPaths.analysis}"/></svg>`; }
document.querySelectorAll('[data-nav]').forEach(el=>el.insertAdjacentHTML('afterbegin',rpIcon({'measure':'scope','sweep':'sweep','lcr':'lcr','lcr-linearity':'archive','file-analysis':'analysis','sweep-analysis':'archive'}[el.dataset.nav])));
for (const [id,name] of Object.entries({captureBtn:'play',stopBtn:'stop',sweepBtn:'sweep',saveNpz:'save',saveCsv:'save',archiveLoadBtn:'archive',archiveReevaluateBtn:'reset',calculateTimeFrequencyBtn:'analysis',calculateModesBtn:'analysis'})) {
 const button=document.getElementById(id); if(button) button.insertAdjacentHTML('afterbegin',rpIcon(name));
}
document.querySelectorAll('button').forEach(button=>{
 const label=button.textContent.trim();
 if(!button.querySelector('svg')){
  const name=/导出|保存/.test(label)?'save':/全时段|复位|恢复/.test(label)?'reset':/显示|缩放/.test(label)?'zoom':/分析|计算|评价/.test(label)?'analysis':null;
  if(name)button.insertAdjacentHTML('afterbegin',rpIcon(name));
 }
 if(label==='×'){button.title='删除频谱时间窗';button.setAttribute('aria-label',button.title);}
});
