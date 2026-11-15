#!/usr/bin/env python3
"""Probe the planned backend namespace without importing or starting the backend.

Uses only approved local images and own ephemeral fixtures; no Internet targets.
Usage: python3 scripts/wingslab-verify-network.py
"""
import json
import argparse
import socket
import subprocess
import threading
import uuid

DOCKER = ['docker', '--context', 'desktop-linux']
IMAGE = 'wingslab-backend@sha256:38909b02db294ab0ff8b0220cb07cd0ab58f7c8964b21bc34ae47f34d1bd4ebe'
ALPINE = 'alpine@sha256:e311ae748be7f56ae5cba304bc488f0786df68ee507513f654a5cc8597cffb42'
LABELS = ['--label', 'org.wingslab.project=wingslab', '--label', 'org.wingslab.phase=2c-probe']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--backend-ingress', action='store_true', help='Expect only backend 3101 ingress in addition to data ports')
parser.add_argument('--customer-ingress', action='store_true', help='Also expect authorized customer 3103 ingress')
parser.add_argument('--restaurant-ingress', action='store_true', help='Also expect authorized restaurant 3102 ingress')
parser.add_argument('--running-backend', action='store_true', help='Probe the verified running backend namespace; stop it on test failure')
parser.add_argument('--running-customer', action='store_true', help='Probe the verified customer namespace; stop customer on test failure')
parser.add_argument('--running-restaurant', action='store_true', help='Probe the verified restaurant namespace; stop restaurant on test failure')
args = parser.parse_args()
if sum([args.running_backend, args.running_customer, args.running_restaurant]) > 1:
    parser.error('Select only one running namespace')
if args.running_customer:
    args.customer_ingress = True
if args.running_restaurant:
    args.restaurant_ingress = True
    args.customer_ingress = True
backend_ingress = args.backend_ingress or args.running_backend or args.customer_ingress
running_service = 'wingslab-2b-customer-1' if args.running_customer else 'wingslab-2b-backend-1'
if args.running_restaurant:
    running_service = 'wingslab-2b-restaurant-1'


def run(arguments, **kwargs):
    result = subprocess.run(DOCKER + arguments, capture_output=True, text=True,
                            timeout=120, **kwargs)
    if result.returncode:
        print(result.stdout)
        print(result.stderr)
        result.check_returncode()
    return result.stdout


context = json.loads(run(['context', 'inspect', 'desktop-linux']))[0]
assert context['Endpoints']['docker']['Host'].startswith('unix://')
network = json.loads(run(['network', 'inspect', 'wingslab_2b_internal']))[0]
assert network['Internal'] and not network['EnableIPv6']
assert network['Labels']['org.wingslab.project'] == 'wingslab'
edge_network = json.loads(run(['network', 'inspect', 'wingslab_2b_edge']))[0]
assert edge_network['Options']['com.docker.network.bridge.enable_icc'] == 'false'
assert edge_network['Labels']['org.wingslab.project'] == 'wingslab'
edge = json.loads(run(['inspect', 'wingslab-2b-edge-1']))[0]
assert edge['HostConfig']['Sysctls']['net.ipv4.ip_forward'] == '0'
assert edge['HostConfig']['Sysctls']['net.ipv6.conf.all.forwarding'] == '0'
assert edge['HostConfig']['Sysctls']['net.ipv6.conf.all.disable_ipv6'] == '1'
expected_ports = {'15432/tcp', '16379/tcp'}
if backend_ingress:
    expected_ports.add('3101/tcp')
if args.customer_ingress:
    expected_ports.add('3103/tcp')
if args.restaurant_ingress:
    expected_ports.add('3102/tcp')
assert set(edge['NetworkSettings']['Ports']) == expected_ports
assert all(binding['HostIp'] == '127.0.0.1' for bindings in
           edge['NetworkSettings']['Ports'].values() for binding in bindings)

host = socket.socket()
host.bind(('127.0.0.1', 0))
host.listen()
host_port = host.getsockname()[1]


def serve():
    while True:
        try:
            connection, _ = host.accept()
            connection.sendall(b'WINGSLAB-PROBE')
            connection.close()
        except OSError:
            return


threading.Thread(target=serve, daemon=True).start()
with socket.create_connection(('127.0.0.1', host_port), timeout=3) as connection:
    assert connection.recv(64) == b'WINGSLAB-PROBE'

name = 'wingslab-2c-fixture-' + uuid.uuid4().hex[:8]
fixture_network = name + '-net'
created_network = created_peer = False
try:
    run(['network', 'create', *LABELS, '--ipv6', '--subnet',
         'fd72:2c:2026::/64', fixture_network])
    created_network = True
    run(['run', '-d', '--pull=never', '--name', name, *LABELS, '--network',
         fixture_network, '--read-only', '--cap-drop=ALL', ALPINE,
         'nc', '-lk', '-p', '31997', '-e', '/bin/cat'])
    created_peer = True
    peer = json.loads(run(['inspect', name]))[0]['NetworkSettings']['Networks'][fixture_network]
    run(['exec', name, 'sh', '-c',
         'nc -z -w 2 127.0.0.1 31997 && nc -z -w 2 ::1 31997'])
    print('PASS simulated outside peer listens on IPv4 and IPv6')
    script = r'''
const net=require('node:net'),dns=require('node:dns').promises,fs=require('node:fs'),assert=require('node:assert/strict');
async function tcp(host,port){return new Promise(resolve=>{const s=net.connect({host,port});let done=false;function finish(ok){if(done)return;done=true;s.destroy();resolve(ok)}s.setTimeout(1500,()=>finish(false));s.on('error',()=>finish(false));s.on('connect',()=>finish(true))})}
async function check(host,port,expected){assert.equal(await tcp(host,port),expected,host+':'+port);console.log('PASS '+(expected?'allowed ':'blocked ')+host+':'+port)}
(async()=>{
assert.equal(process.getuid(),1000);
assert(!fs.readFileSync('/proc/net/route','utf8').split('\n').some(l=>l.trim().split(/\s+/)[1]==='00000000'));
assert.equal(fs.readFileSync('/proc/sys/net/ipv4/ip_forward','utf8').trim(),'0');
assert.equal(fs.readFileSync('/proc/sys/net/ipv6/conf/all/disable_ipv6','utf8').trim(),'1');
console.log('PASS service namespace has no default route or forwarding; IPv6 disabled');
await check('172.30.240.10',5432,true);await check('172.30.240.11',6379,true);
await check(PEER4,31997,false);await check(PEER6,31997,false);
await check('host.docker.internal',HOSTPORT,false);await check('172.30.240.1',HOSTPORT,false);
for(const ip of ['172.30.240.30','172.31.240.10'])for(const port of [15432,16379,3101,3102,3103,3104])await check(ip,port,false);
const own=await dns.lookup('wingslab-2b-postgres-1');assert.equal(own.address,'172.30.240.10');console.log('PASS internal service DNS');
await assert.rejects(dns.lookup('wingslab-2c-fixture.invalid'));console.log('PASS outside fixture DNS rejected');
console.log('Probe did not import or start the backend entrypoint');
})().catch(e=>{console.error(e.message);process.exitCode=1});
'''
    script = script.replace('PEER4', json.dumps(peer['IPAddress'])).replace(
        'PEER6', json.dumps(peer['GlobalIPv6Address'])).replace('HOSTPORT', str(host_port))
    if args.running_backend or args.running_customer or args.running_restaurant:
        backend = json.loads(run(['inspect', running_service]))[0]
        assert backend['Config']['Labels']['org.wingslab.project'] == 'wingslab'
        expected_image = 'wingslab-customer:phase3' if args.running_customer else IMAGE
        if args.running_restaurant:
            expected_image = 'wingslab-restaurant:phase3b'
        assert backend['Image'] == json.loads(run(['image', 'inspect', expected_image]))[0]['Id']
        assert set(backend['NetworkSettings']['Networks']) == {'wingslab_2b_internal'}
        expected_ip = '172.30.240.23' if args.running_restaurant else ('172.30.240.22' if args.running_customer else '172.30.240.21')
        assert backend['NetworkSettings']['Networks']['wingslab_2b_internal']['IPAddress'] == expected_ip
        assert backend['HostConfig']['CapDrop'] == ['ALL']
        assert backend['HostConfig']['ReadonlyRootfs']
        print(run(['exec', '--user', '1000:1000', '-i', running_service, 'node', '-'], input=script))
    else:
        print(run(['run', '--rm', '--pull=never', *LABELS, '--network',
                   'wingslab_2b_internal', '--ip', '172.30.240.21', '--read-only',
                   '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
                   '--sysctl', 'net.ipv4.ip_forward=0', '--sysctl', 'net.ipv6.conf.all.forwarding=0',
                   '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1', '-i', IMAGE, 'node', '-'], input=script))
    probe = '''set -eu
for p in 15432 16379 3101 3102 3103 3104; do
  if nc -z -w 2 172.31.240.10 "$p"; then echo "FAIL edge peer access $p"; exit 1; fi
done
if nc -z -w 2 172.30.240.10 5432 || nc -z -w 2 172.30.240.11 6379; then
  echo 'FAIL cross-network data access'; exit 1
fi
echo 'PASS edge peers cannot reach relays or internal data services'
'''
    print(run(['run', '--rm', '--pull=never', *LABELS, '--network', 'wingslab_2b_edge',
               '--read-only', '--cap-drop=ALL', '--user', '1000:1000', ALPINE, 'sh', '-c', probe]))
    for port in [int(p.split('/')[0]) for p in expected_ports]:
        with socket.create_connection(('127.0.0.1', port), timeout=3):
            print('PASS host loopback ingress', port)
    for port in [p for p in [3101, 3102, 3103, 3104] if str(p) + '/tcp' not in expected_ports]:
        try:
            connection = socket.create_connection(('127.0.0.1', port), timeout=1)
        except (ConnectionRefusedError, socket.timeout):
            print('PASS closed application port', port)
        else:
            connection.close()
            raise RuntimeError('Unexpected application listener: ' + str(port))
    print('ALL NETWORK TESTS PASSED')
except Exception:
    if args.running_backend or args.running_customer or args.running_restaurant:
        # Never leave the authorized backend running after a failed isolation test.
        run(['stop', running_service])
    raise
finally:
    if created_peer:
        run(['rm', '-f', name])
    if created_network:
        run(['network', 'rm', fixture_network])
    host.close()
