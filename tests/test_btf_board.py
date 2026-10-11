"""BTF board-specific API contracts; all captures are simulated."""
import copy
import io
import json
from pathlib import Path
import time
import unittest
from unittest.mock import MagicMock, patch
import zipfile
import test_http
from redscope.hardware_config import defaults
from redscope import storage_naming, web


class BtfBoardTests(unittest.TestCase):
    setUp=test_http.HttpTests.setUp
    tearDown=test_http.HttpTests.tearDown
    request=test_http.HttpTests.request

    def payload(self):
        config=defaults().to_dict();config['redpitaya']['mode']='out1'
        return {'simulate':True,'config':config,'bias':{
            'stop_a':.5,'repeats':5,'interval_s':0,'stable_hold_s':.01,'poll_s':.01,'cooldown_s':0,
            'amplitude_mode':'fixed','amplitude_fixed_vpp':.1}}

    def test_new_routes_and_every_script_are_local(self):
        for path in ['/bias-scan','/magnetic-diagnosis','/ui/workstation.js','/ui/file-picker.js',
                     '/ui/analysis-state.js','/ui/storage-naming.js','/analysis/time-frequency.js',
                     '/analysis/experimental.js','/views/bias-scan.js','/views/instruments.js',
                     '/views/signal-analysis.js','/btf.js','/btf.css','/icon.svg','/interference/board.js']:
            with self.subTest(path=path):self.assertEqual(self.request(path)[0],200)

    def test_capture_metadata_and_btf_bias_archive(self):
        payload=self.payload()
        payload['bias'].update(excitation_voltage_channel='B')
        payload['config']['redpitaya']['roles']['B']='monitor'
        code,body=self.request('/api/bias-scan/preflight',payload)
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)['acquisition']['total_samples'] if 'total_samples' in json.loads(body)['acquisition'] else
                         sum(json.loads(body)['acquisition'][key] for key in ['pre_trigger_samples','post_trigger_samples']),10000)
        self.assertEqual(self.request('/api/bias-scan/start',payload,headers={'X-Hann-Client':'btf-test'})[0],202)
        deadline=time.monotonic()+10
        while self.http.control.snapshot()['state']=='running' and time.monotonic()<deadline:time.sleep(.01)
        state=self.http.control.snapshot();self.assertEqual(state['state'],'complete',state)
        result=json.loads(self.request('/api/bias-scan/result')[1])
        self.assertTrue(result['simulated']);self.assertEqual(result['output_state'],'off')
        self.assertEqual(len(result['runs']),10)
        self.assertEqual(len(result['summary']),2)
        for row in result['runs']:
            self.assertEqual(row['awg_vpp'],.1)
            self.assertTrue((Path(result['output_dir'])/row['file']).is_file())
        preview=json.loads(self.request('/api/bias-scan/preview?point=1&repeat=1')[1])
        self.assertEqual(preview['excitation']['voltage']['channel'],'B')
        self.assertLessEqual(len(preview['time_us']),4000)
        code,body=self.request('/api/bias-scan/export?name=all.zip')
        self.assertEqual(code,200,body[:200])
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            self.assertEqual(sum(name.endswith('.npz') for name in archive.namelist()),10)

    def test_bias_preflight_rejects_unsupported_hardware_before_on(self):
        original=self.payload()
        cases=[]
        value=copy.deepcopy(original);value['config']['redpitaya']['mode']='alternating';cases.append(value)
        value=copy.deepcopy(original);value['config']['sample_rate_hz']=20e6;cases.append(value)
        value=copy.deepcopy(original);value['bias']['amplitude_fixed_vpp']=4;cases.append(value)
        value=copy.deepcopy(original);value['bias']['memory_limit_mb']=257;cases.append(value)
        value=copy.deepcopy(original);value['bias']['pzt_channel']='H';cases.append(value)
        value=copy.deepcopy(original);value['bias'].update(waveform_guard_enabled=True,excitation_voltage_channel='B',excitation_current_channel='C');cases.append(value)
        value=copy.deepcopy(original);value['bias']['record_duration_us']=500000;cases.append(value)
        value=copy.deepcopy(original);value['config']['redpitaya']['output2']={'pk_to_pk_v':.3};cases.append(value)
        for payload in cases:
            with self.subTest(payload=payload):self.assertEqual(self.request('/api/bias-scan/preflight',payload)[0],400)
        self.assertIsNone(self.http.control.bias_controller)

    def test_names_browser_and_readonly_reference_boundary(self):
        self.assertEqual(self.request('/api/storage/naming',{'names':{'capture':'试件BTF'}})[0],200)
        names=json.loads(self.request('/api/storage/naming')[1])['names']
        self.assertEqual(names['capture'],'试件BTF')
        code,body=self.request('/api/files/list',{'path':''})
        self.assertEqual(code,200,body)
        self.assertEqual(Path(json.loads(body)['path']),self.root)
        self.assertEqual(self.request('/api/files/list',{'path':'../Pico_4824A_btf'})[0],400)
        self.assertEqual(self.request('/api/storage/naming',{'names':{'capture':'../Pico'}})[0],400)
        with self.assertRaises(ValueError):storage_naming.output_path(self.root.parent/'Pico_4824A_btf')

    def test_disconnect_stops_bias_owner_and_unknown_blocks_all_tasks(self):
        self.http.control.status.state='running';self.http.control.status.task_kind='bias_scan'
        with patch.object(self.http.control,'bias_controller') as controller:
            self.http.lease_owner='btf-test'
            self.assertEqual(self.request('/api/release',{'client':'btf-test'})[0],200)
            controller.stop.assert_called_once()
        self.http.control.status.state='idle';self.http.control.bias_unknown=True
        self.assertGreaterEqual(self.request('/api/capture',{**defaults().to_dict(),'simulate':True})[0],400)
        self.assertGreaterEqual(self.request('/api/bias-scan/start',self.payload())[0],400)

    def test_manual_formats_keep_decimal_frequency_and_shared_directory(self):
        config=defaults();config.redpitaya['mode']='out1'
        from redscope.device import RedPitaya
        with RedPitaya(simulate=True) as device:self.http.control.result=device.capture(config)
        npz=self.http.control.save('npz');csv=self.http.control.save('csv')
        self.assertEqual(npz.parent,csv.parent);self.assertEqual(npz.stem,csv.stem)
        self.assertIn('73.7kHz',npz.name)


class DacOffContractTests(unittest.TestCase):
    def test_off_ack_does_not_cancel_later_captures(self):
        from redscope.device import RedPitaya
        device=RedPitaya();connection=MagicMock()
        connection.__enter__.return_value=connection;connection.recv.return_value=b'OK\n'
        with patch.object(device,'_socket',return_value=connection):device.disable_awg_output()
        connection.sendall.assert_called_once_with(b'OFF\n')
        self.assertFalse(device.cancel.is_set())

    def test_off_transport_and_negative_ack_propagate(self):
        from redscope.device import RedPitaya
        device=RedPitaya()
        with patch.object(device,'_socket',side_effect=RuntimeError('disconnected')):
            with self.assertRaises(RuntimeError):device.disable_awg_output()
        for reply in (b'',b'ERR capture busy\n'):
            with self.subTest(reply=reply):
                connection=MagicMock();connection.__enter__.return_value=connection
                connection.recv.return_value=reply
                with patch.object(device,'_socket',return_value=connection):
                    with self.assertRaises(RuntimeError):device.disable_awg_output()

    def test_simulated_off_never_opens_hardware_socket(self):
        from redscope.device import RedPitaya
        device=RedPitaya(simulate=True)
        with patch.object(device,'_socket',side_effect=AssertionError('real socket')):
            device.disable_awg_output()
        self.assertFalse(device.cancel.is_set())


if __name__=='__main__':unittest.main()
