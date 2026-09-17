#!/usr/bin/env python3
"""Check image content IDs without emitting resolved Compose secrets."""
import json
import subprocess
import sys

expected = {
    'postgres': {'sha256:1bea307dfb3ee30541a7acf7de14b58bcd6948da98e5d31a04c627c4d35ec64b', 'sha256:7456ef82e5f5bc43d997f4781bbd7c0d6389bff397564649a356e206ba473aee'},
    'app': {'sha256:9cbab4f7b22aa941a275388d17ff4c0f904c37ba48638c9dc516ee85fb7b06ed', 'sha256:828dd46b21bf922ffaac870c7cf5895d97bc4b1f48e2eb08880284d241de4d35'},
}
result = subprocess.run(['docker', 'compose', 'config', '--format', 'json'], capture_output=True)
if result.returncode:
    sys.exit('Compose configuration could not be resolved.')
config = json.loads(result.stdout)
for service, content_ids in expected.items():
    image = config['services'][service]['image']
    result = subprocess.run(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], capture_output=True, text=True)
    # Classic Docker identifies images by config digest; containerd uses manifest digest.
    if result.returncode or result.stdout.strip() not in content_ids:
        sys.exit(f'{service}: the required verified image is not ready.')
print('CJW_RESUME_IMAGES_READY')
