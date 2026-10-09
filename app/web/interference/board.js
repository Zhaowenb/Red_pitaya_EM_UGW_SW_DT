/* Imported three-channel evidence stays explicitly separate from board capture. */
const boardNote='本板只有 IN1 / IN2：此三通道干扰流程仅支持历史会话导入、比较、重新分析和导出。';
document.querySelector('header h1').textContent='干扰排查 · 历史数据分析';
document.querySelector('header small').textContent='RED PITAYA · PICO ARCHIVE ANALYSIS';
document.querySelector('aside .muted').textContent=boardNote;
const back=document.querySelector('a[href="/measure"]');back.textContent='返回 Red Pitaya 测量';
const importer=document.createElement('article');
importer.innerHTML='<h2>导入历史干扰会话</h2><p>选择包含 session.json 和 runs 的 ZIP 归档；将在本机保存副本，重新分析只修改副本。</p><input id="boardSessionZip" type="file" accept=".zip"><button id="boardSessionImport">上传并导入会话</button>';
document.querySelector('section.main').prepend(importer);
document.getElementById('boardSessionImport').onclick=async()=>{try{
  const file=document.getElementById('boardSessionZip').files[0];if(!file)throw Error('请选择会话 ZIP');
  const response=await fetch('/api/upload',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name)},body:file});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  const result=await api('/api/interference/import','POST',{directory:data.path});
  restore(result);localStorage.setItem('interference-session-id',result.session.id);message('已导入副本。'+boardNote);
}catch(error){message(error.message);}};
for(const id of ['startCondition','newSession','createSession'])document.getElementById(id).onclick=()=>message(boardNote);
createSession=async()=>message(boardNote);
startCondition=async()=>message(boardNote);
