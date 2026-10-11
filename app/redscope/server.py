"""Board HTTP service, bounded analysis worker and portable data transport."""
import argparse
import io
import json
import mimetypes
import multiprocessing as mp
import os
import re
from pathlib import Path
import shutil
import socket
import tempfile
import threading
import time
import uuid
import zipfile
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from . import web
from .hardware_config import capabilities

ROOT = web.DATA_DIR
MAX_UPLOAD = 128 * 1024 * 1024
# Fast, bounded single-file operations run in the requesting HTTP worker.  They
# used to spawn a fresh Python interpreter for every zoom or button press,
# which cost several seconds on Zynq before NumPy did any useful work.
ANALYSIS_PATHS = {'/api/analysis/run-preview','/api/analysis/sweep-reevaluate','/api/analysis/export',
                  '/api/lcr-analysis/load','/api/big-lcr/linearity'}
HARDWARE_PATHS = {'/api/capture','/api/sweep/start','/api/lcr/start','/api/lcr/calibrate',
                  '/api/big-lcr/start','/api/lcr-linearity/start','/api/bias-scan/start'}

def managed_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute(): path = ROOT / path
    path = path.resolve()
    if path != ROOT and ROOT not in path.parents:
        raise ValueError('只能访问板端数据目录内的文件；电脑文件请先上传')
    return path

def check_space(needed=0):
    ROOT.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(ROOT).free < needed + 64*1024*1024:
        raise ValueError('数据盘空间不足；需保留至少 64 MiB')

def check_npz(path):
    if path.suffix.lower() == '.npz':
        with zipfile.ZipFile(path) as archive:
            if sum(info.file_size for info in archive.infolist()) > 192*1024*1024:
                raise ValueError('NPZ 展开数据超过板端单文件预算 192 MiB')

def watchdog(server):
    while not server.shutdown_event.wait(1):
        if server.control.snapshot()['state'] in ('running','paused') and time.monotonic() > server.lease_deadline:
            try: server.control.stop()
            except RuntimeError: pass

def analysis_worker(path,payload,output,data_root=None):
    global ROOT
    if data_root is not None:
        ROOT=web.DATA_DIR=Path(data_root)
    try:
        if os.name == 'posix':
            import resource
            budget=int(os.environ.get('HANNSCOPE_ANALYSIS_MB','640'))*1024*1024
            resource.setrlimit(resource.RLIMIT_AS,(budget,budget))
        handler=web.PicoWebHandler.__new__(web.PicoWebHandler)
        from types import SimpleNamespace
        handler.server=SimpleNamespace(control=web.WebControlState())
        handler.path=path
        handler._read_json=lambda: payload
        def send(value,status=200):
            if status>=400: raise ValueError(value.get('error','Analysis failed'))
            if path == '/api/analysis/sweep-reevaluate' or path == '/api/big-lcr/linearity' or (path == '/api/lcr-analysis/load' and payload.get('reanalyze')):
                report=ROOT/'derived'/('reevaluation_'+uuid.uuid4().hex+'.json')
                report.parent.mkdir(parents=True,exist_ok=True)
                report.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
                value['report_path']=str(report)
            with open(output,'w',encoding='utf-8') as stream:
                json.dump({'state':'complete','result':value},stream,ensure_ascii=False)
        handler._send_json=send
        handler.do_POST()
    except Exception as error:
        with open(output,'w',encoding='utf-8') as stream:
            json.dump({'state':'error','error':str(error) or '分析内存预算不足'},stream)

class Jobs:
    def __init__(self):
        self.lock=threading.Lock(); self.current=None
    def start(self,path,payload):
        with self.lock:
            if self.current and self.current['process'].is_alive():
                raise RuntimeError('已有分析任务运行，请等待或取消')
            if self.current:
                self.current['process'].join(); self.current['file'].unlink(missing_ok=True)
            directory=ROOT/'.jobs'; directory.mkdir(parents=True,exist_ok=True)
            task_id=uuid.uuid4().hex; result=directory/(task_id+'.json')
            process=mp.get_context('spawn').Process(target=analysis_worker,args=(path,payload,str(result),str(ROOT)),daemon=True)
            process.start()
            self.current={'id':task_id,'process':process,'file':result,'started':time.time(),'cancelled':False}
            return task_id
    def get(self,task_id):
        with self.lock:
            job=self.current
            if not job or job['id']!=task_id: raise ValueError('Task not found')
            if job['cancelled']: return {'state':'cancelled'}
            if job['process'].is_alive(): return {'state':'running','elapsed_s':time.time()-job['started']}
            job['process'].join()
            if not job['file'].exists(): return {'state':'error','error':'分析进程退出：可能超出内存预算'}
            return json.loads(job['file'].read_text(encoding='utf-8'))
    def cancel(self):
        with self.lock:
            if self.current and self.current['process'].is_alive():
                self.current['process'].terminate(); self.current['process'].join(3); self.current['cancelled']=True

def telemetry():
    target_model='STEMlab 125-14 Pro Z7020 Gen2'
    result={'model':target_model,'target_model':target_model,'hardware_connected':False,'temperature_c':None,
            'cpu_load_1m':None,'memory_used_percent':None,'uptime_s':None,'os_version':None}
    if os.name=='posix':
        try: result['model']=Path('/proc/device-tree/model').read_bytes().decode().rstrip('\0')
        except (OSError,UnicodeError): pass
        try:
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
                connection.settimeout(.3); connection.connect(os.environ.get('HANNSCOPE_SOCKET','/run/hann_scope/hardware.sock'))
                connection.sendall(b'PING\n'); result['hardware_connected']=connection.recv(100).startswith(b'OK')
        except OSError: pass
        result['cpu_load_1m']=os.getloadavg()[0]
        try:
            result['uptime_s']=float(Path('/proc/uptime').read_text().split()[0])
            mem={line.split(':')[0]:int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if len(line.split())>=2}
            result['memory_used_percent']=100*(1-mem.get('MemAvailable',mem['MemFree'])/mem['MemTotal'])
            version_text=Path('/opt/redpitaya/version.txt').read_text()
            version=next((line.split(':',1)[1].strip() for line in version_text.splitlines() if 'Version:' in line),None)
            build=next((line.split(':',1)[1].strip() for line in version_text.splitlines() if 'Build:' in line),None)
            result['os_version']=' · '.join(part for part in (f'Red Pitaya OS {version}' if version else None,f'Build {build}' if build else None) if part)
        except (OSError,ValueError,KeyError): pass
        for folder in Path('/sys/bus/iio/devices').glob('iio:device*'):
            try:
                result['temperature_c']=(float((folder/'in_temp0_raw').read_text())+float((folder/'in_temp0_offset').read_text()))*float((folder/'in_temp0_scale').read_text())/1000
                break
            except (OSError,ValueError): pass
    disk=shutil.disk_usage(ROOT)
    result.update(storage_used_percent=100*disk.used/disk.total,storage_free_bytes=disk.free)
    return result

class Handler(web.PicoWebHandler):
    server_version='HannBurstScope/2.0'
    def do_GET(self):
        parsed=urlparse(self.path); query=parse_qs(parsed.query)
        try:
            if parsed.path=='/api/capabilities':
                self._send_json({**capabilities(),'data_root':str(ROOT),'hardware':telemetry()}); return
            if parsed.path=='/api/system':
                snapshot=telemetry(); snapshot['task']=self.control.snapshot()
                snapshot['clock_state']='未核验'; snapshot['runtime']='board' if os.name=='posix' else 'local-test'
                self._send_json(snapshot); return
            if parsed.path=='/api/jobs':
                task_id=query.get('id',[None])[0]
                if task_id is None:
                    current=self.server.jobs.current
                    self._send_json({'id':current['id'] if current else None}); return
                self._send_json(self.server.jobs.get(task_id)); return
            if parsed.path=='/api/result':
                excitation=query.get('excitation',[''])[0]
                if excitation:
                    # Check and replace atomically: a newly started LCR task
                    # must not have its result overwritten by a stale GET.
                    with self.control._lock:
                        if self.control.status.task_kind != 'capture':
                            raise ValueError('仅独立采集任务支持切换发射结果；当前任务请使用对应的逐次波形入口')
                        if self.control.status.state in ('running', 'paused'):
                            raise ValueError('请等待采集结束后切换发射结果')
                        capture=next((item for item in self.control.captures
                                      if item.config.redpitaya.get('excitation_id')==excitation),None)
                        if capture is None:
                            raise ValueError(f'当前采集没有 {excitation} 结果')
                        self.control.result=capture
                self._send_json(self.control.result_payload()); return
            if parsed.path=='/api/download': self.download(query.get('path',[''])[0]); return
            if parsed.path in ('/icons.js','/board.js','/port.js','/board.css','/icon.svg','/favicon.png','/interference/board.js','/shell-board.js'):
                self._send_asset(parsed.path[1:],mimetypes.guess_type(parsed.path)[0] or 'application/octet-stream'); return
            super().do_GET()
        except Exception as error: self._send_json({'error':str(error)},400)

    def _read_json(self):
        if hasattr(self,'payload'): return self.payload
        return super()._read_json()

    def do_POST(self):
        path=urlparse(self.path).path
        try:
            origin=self.headers.get('Origin')
            if origin and urlparse(origin).netloc!=self.headers.get('Host'):
                # Drain small rejected control bodies so Windows does not reset
                # the connection before the browser receives the JSON error.
                length=int(self.headers.get('Content-Length','0'))
                if 0 < length <= 1_000_000: self.rfile.read(length)
                raise ValueError('Cross-origin control requests are disabled')
            if path=='/api/upload': self.upload(); return
            self.payload=super()._read_json()
            if path=='/api/interference/import':
                folder=managed_path(self.payload.get('directory',''))
                session=json.loads((folder/'session.json').read_text(encoding='utf-8'))
                if not isinstance(session.get('runs'),list) or len(session['runs'])>10000:
                    raise ValueError('无效或过大的干扰会话')
                files=[]
                for row in session['runs']:
                    for key in ('raw_file','fft_file'):
                        relative=Path(row[key]); source=(folder/relative).resolve()
                        if relative.is_absolute() or not source.is_relative_to(folder) or not source.is_file():
                            raise ValueError('会话原始数据路径无效')
                        check_npz(source); files.append((relative,source))
                check_space(sum(p.stat().st_size for _,p in files))
                session['id']=uuid.uuid4().hex
                destination=self.control.interference_output_root/session['id']
                destination.mkdir(parents=True,exist_ok=False)
                for relative,source in files:
                    target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
                web.interference._write_json(destination/'session.json',session)
                self._send_json({'session':session,'summary':web.interference.summarize(session)});return
            if path=='/api/heartbeat':
                if self.payload.get('client') == self.server.lease_owner:
                    self.server.lease_deadline=time.monotonic()+20
                self._send_json({'ok':True}); return
            if path=='/api/release':
                if self.payload.get('client')==self.server.lease_owner and self.control.snapshot()['state'] in ('running','paused'): self.control.stop()
                self._send_json({'ok':True}); return
            if 'path' in self.payload:
                self.payload['path']=str(managed_path(self.payload['path']))
                source=Path(self.payload['path'])
                if source.is_file() and source.stat().st_size>MAX_UPLOAD:
                    raise ValueError('文件超出板端单文件预算 128 MiB')
                if source.is_file(): check_npz(source)
            for cfg in (self.payload,self.payload.get('config',{})):
                awgs=[cfg.get('awg',{}),cfg.get('redpitaya',{}).get('output2',{})]
                for awg in awgs:
                    if awg.get('custom_csv'): awg['custom_csv']=str(managed_path(awg['custom_csv']))
            if self.payload.get('directory'):
                self.payload['directory']=str(managed_path(self.payload['directory']))
            lcr=self.payload.get('lcr',{})
            if lcr.get('calibration_file'):
                lcr['calibration_file']=str(managed_path(lcr['calibration_file']))
            if path=='/api/awg-preview' and self.payload.get('custom_csv'):
                self.payload['custom_csv']=str(managed_path(self.payload['custom_csv']))
            if path in HARDWARE_PATHS or path=='/api/save': check_space()
            if path in HARDWARE_PATHS:
                if self.control.snapshot()['state'] in ('running','paused'): raise ValueError('已有硬件任务运行')
                self.server.lease_owner=self.headers.get('X-Hann-Client','')
                self.server.lease_deadline=time.monotonic()+20
            if path in ANALYSIS_PATHS:
                check_space(); self._send_json({'job_id':self.server.jobs.start(path,self.payload)},202); return
            if path=='/api/jobs/cancel': self.server.jobs.cancel(); self._send_json({'ok':True}); return
            if path=='/api/stop':
                if self.control.snapshot()['state'] in ('running','paused'): self.control.stop()
                self._send_json({'ok':True}); return
            super().do_POST()
        except Exception as error: self._send_json({'error':str(error)},400)

    def upload(self):
        size=int(self.headers.get('Content-Length','0'))
        if size<=0 or size>MAX_UPLOAD: raise ValueError('上传大小必须在 1 B–128 MiB')
        name=unquote(self.headers.get('X-Filename','upload.npz'))
        if '/' in name or '\\' in name or name in ('.','..'): raise ValueError('Invalid filename')
        if Path(name).suffix.lower() not in ('.npz','.csv','.json','.zip'): raise ValueError('只允许 NPZ/CSV/JSON/ZIP')
        check_space(size*3)
        batch=self.headers.get('X-Upload-Batch',uuid.uuid4().hex)
        if not re.fullmatch('[a-f0-9]{32}',batch): raise ValueError('Invalid upload batch')
        folder=ROOT/'uploads'/batch; folder.mkdir(parents=True,exist_ok=True)
        target=folder/name
        if target.exists(): raise ValueError('该批次已有同名文件，请重新选择文件上传')
        remaining=size
        with target.open('wb') as stream:
            while remaining:
                chunk=self.rfile.read(min(remaining,1024*1024))
                if not chunk: raise ValueError('Incomplete upload')
                stream.write(chunk); remaining-=len(chunk)
        if target.suffix.lower()=='.zip':
            with zipfile.ZipFile(target) as archive:
                if len(archive.infolist())>12000 or sum(i.file_size for i in archive.infolist())>512*1024*1024:
                    raise ValueError('ZIP 解压内容超过板端预算')
                for info in archive.infolist():
                    destination=(folder/info.filename.replace('\\','/')).resolve()
                    if folder not in destination.parents or (info.external_attr>>16)&0o170000==0o120000:
                        raise ValueError('Unsafe archive member')
                    if not info.is_dir() and destination.suffix.lower() not in ('.npz','.csv','.json'):
                        raise ValueError('ZIP 仅允许数据文件')
                check_space(sum(i.file_size for i in archive.infolist()))
                archive.extractall(folder)
            configs=[p for name in ('sweep_config.json','lcr_config.json','big_lcr_config.json','linearity_config.json','session.json','config.json') for p in folder.rglob(name)]
            target=configs[0].parent if len(configs)==1 else folder
            for data in folder.rglob('*.npz'): check_npz(data)
        else: check_npz(target)
        kind='data'
        if target.is_file() and target.suffix.lower()=='.json':
            try:
                if json.loads(target.read_text(encoding='utf-8')).get('schema')=='pico4824a-lcr-resistor-calibration-v1':
                    kind='calibration'
                    imported=ROOT/'lcr'/('lcr_import_'+uuid.uuid4().hex)/'calibration.json'
                    imported.parent.mkdir(parents=True);shutil.copy2(target,imported);target=imported
            except (ValueError,AttributeError): pass
        self._send_json({'path':str(target),'kind':kind})

    def download(self,value):
        path=managed_path(value)
        if not path.exists(): raise ValueError('File not found')
        companion=path.with_suffix('.json') if path.suffix.lower()=='.csv' else None
        if path.is_dir() or (companion and companion.is_file()):
            with tempfile.TemporaryFile() as stream:
                with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
                    for item in (path.rglob('*') if path.is_dir() else [path,companion]):
                        if item.is_file() and not item.is_symlink() and '.jobs' not in item.parts:
                            archive.write(item,item.relative_to(path if path.is_dir() else path.parent))
                stream.seek(0,2); size=stream.tell(); stream.seek(0)
                self.send_response(200); self.send_header('Content-Type','application/zip'); self.send_header('Content-Length',str(size)); self.send_header('Content-Disposition','attachment; filename="hann-scope-archive.zip"'); self.end_headers(); shutil.copyfileobj(stream,self.wfile)
        else:
            self.send_response(200); self.send_header('Content-Type','application/octet-stream'); self.send_header('Content-Length',str(path.stat().st_size)); self.send_header('Content-Disposition',f'attachment; filename="capture{path.suffix}"'); self.end_headers()
            with path.open('rb') as stream: shutil.copyfileobj(stream,self.wfile)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--host',default='0.0.0.0'); parser.add_argument('--port',type=int,default=4825); args=parser.parse_args()
    ROOT.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer((args.host,args.port),Handler); server.control=web.WebControlState(); server.jobs=Jobs()
    server.web_assets=web.snapshot_web_assets()
    server.lease_owner=''; server.lease_deadline=0; server.shutdown_event=threading.Event()
    threading.Thread(target=watchdog,args=(server,),daemon=True).start()
    print(f'Red Pitaya BTF http://{args.host}:{args.port}',flush=True)
    try: server.serve_forever()
    finally:
        server.shutdown_event.set()
        server.jobs.cancel()
        try: server.control.shutdown()
        finally: server.server_close()

if __name__=='__main__': main()
