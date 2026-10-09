"""Local HTTP safety/transport regression. Never connects to hardware."""
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
from redscope import server, web
from redscope.hardware_config import defaults


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name).resolve()
        self.patches=[patch.object(server,'ROOT',self.root),patch.object(web,'DATA_DIR',self.root)]
        for item in self.patches: item.start()
        self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.http.control=web.WebControlState(self.root/'sweeps'); self.http.jobs=server.Jobs()
        self.http.lease_owner=''; self.http.lease_deadline=0
        self.http.shutdown_event=threading.Event()
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True); self.thread.start()
        self.base=f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown_event.set(); self.http.jobs.cancel()
        self.http.shutdown(); self.http.server_close(); self.thread.join(3)
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def request(self,path,payload=None,body=None,headers=None):
        if payload is not None: body=json.dumps(payload).encode()
        req=urllib.request.Request(self.base+path,data=body,headers=headers or {})
        try:
            with urllib.request.urlopen(req,timeout=10) as response:
                return response.status,response.read()
        except urllib.error.HTTPError as error:
            return error.code,error.read()

    def test_capture_four_paths_and_download(self):
        cfg=defaults().to_dict(); cfg['simulate']=True
        code,_=self.request('/api/capture',cfg,headers={'X-Hann-Client':'test'})
        self.assertEqual(code,202)
        for _ in range(100):
            status=json.loads(self.request('/api/status')[1])
            if status['state']!='running': break
            time.sleep(.02)
        self.assertEqual(status['state'],'complete')
        self.assertEqual(len(status['capture_files']),2)
        for excitation in ('OUT1','OUT2'):
            code,body=self.request('/api/result?excitation='+excitation)
            self.assertEqual(code,200)
            self.assertEqual(json.loads(body)['summary']['samples'],50000)
        path=urllib.parse.quote(status['capture_files'][0])
        code,body=self.request('/api/download?path='+path)
        self.assertEqual(code,200); self.assertTrue(zipfile.is_zipfile(io.BytesIO(body)))

    def test_path_escape_and_origin_rejected(self):
        self.assertEqual(self.request('/api/analysis/browse',{'path':'../outside'})[0],400)
        self.assertEqual(self.request('/api/stop',{},headers={'Origin':'http://outside.invalid'})[0],400)

    def test_zip_traversal_rejected(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive: archive.writestr('../outside.csv','bad')
        code,_=self.request('/api/upload',body=stream.getvalue(),headers={'X-Filename':'attack.zip'})
        self.assertEqual(code,400); self.assertFalse((self.root/'outside.csv').exists())

    def test_companion_files_share_batch_without_overwrite(self):
        batch='a'*32
        paths=[]
        for name,data in [('sample.csv',b'time_s,ch_A_v\n0,1\n'),('sample.json',b'{}')]:
            code,body=self.request('/api/upload',body=data,headers={'X-Filename':name,'X-Upload-Batch':batch})
            self.assertEqual(code,200); paths.append(Path(json.loads(body)['path']))
        self.assertEqual(paths[0].parent,paths[1].parent)
        self.assertEqual(self.request('/api/upload',body=b'{}',headers={'X-Filename':'sample.json','X-Upload-Batch':batch})[0],400)

    def test_owner_heartbeat_only(self):
        self.http.lease_owner='owner'; self.http.lease_deadline=0
        self.request('/api/heartbeat',{'client':'other'})
        self.assertEqual(self.http.lease_deadline,0)
        self.request('/api/heartbeat',{'client':'owner'})
        self.assertGreater(self.http.lease_deadline,time.monotonic())

    def test_watchdog_stops_expired_task(self):
        from unittest.mock import Mock
        control=Mock(); control.snapshot.return_value={'state':'running'}
        self.http.control=control; self.http.lease_deadline=0
        control.stop.side_effect=self.http.shutdown_event.set
        worker=threading.Thread(target=server.watchdog,args=(self.http,),daemon=True)
        worker.start(); worker.join(3)
        control.stop.assert_called_once()

    def test_disk_space_failure_is_explicit(self):
        from collections import namedtuple
        usage=namedtuple('usage','total used free')(100,99,1)
        with patch.object(server.shutil,'disk_usage',return_value=usage):
            code,body=self.request('/api/save',{'format':'npz'})
        self.assertEqual(code,400); self.assertIn('空间不足',json.loads(body)['error'])

if __name__=='__main__': unittest.main()
