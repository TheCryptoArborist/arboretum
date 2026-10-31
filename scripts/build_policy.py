"""Read the shared Node build policy without changing the provider environment."""
import json
from pathlib import Path
import subprocess


def get_build_policy():
    output = subprocess.check_output(
        ['node', str(Path(__file__).with_name('build-policy.mjs')), '--json'],
        text=True,
    )
    return json.loads(output)
