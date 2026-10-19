#!/usr/bin/env python3
"""Download and verify the Linux x86-64 compiler and exact framework inputs.

Only public pinned MystenLabs release/commit archives are retrieved. Downloads
and extraction stay in the supplied work directory; no wallet or chain call is
made. Run build_reconstruction.py separately to compile and compare outputs.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import shutil
import tarfile
import time
import urllib.request

from build_reconstruction import (
    COMPILER_ARCHIVE_SHA256, COMPILER_BINARY_SHA256, FRAMEWORK_ARCHIVE_SHA256,
    FRAMEWORK_REVISION, REPO, sha256, verify_framework_sources,
)


def download(url: str, path: Path, expected: str) -> None:
    if path.exists():
        assert sha256(path) == expected, f'Existing archive hash mismatch: {path}'
        return
    partial = path.with_suffix(path.suffix + '.partial')
    request = urllib.request.Request(url, headers={'User-Agent': 'Arboretum-source-reconstruction/1.0'})
    total, last = 0, time.monotonic()
    with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as out:
        while chunk := response.read(4 * 1024 * 1024):
            out.write(chunk)
            total += len(chunk)
            if time.monotonic() - last >= 20:
                print(json.dumps({'file': path.name, 'downloaded_mb': round(total/1e6, 1)}), flush=True)
                last = time.monotonic()
    assert sha256(partial) == expected, f'Download hash mismatch: {path.name}'
    partial.rename(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path, required=True)
    args = parser.parse_args()
    root = args.work_dir.resolve()
    assert root != REPO and REPO not in root.parents, 'Keep compiler downloads outside the repository'
    assert platform.system() == 'Linux' and platform.machine() in {'x86_64', 'AMD64'}, 'Linux x86-64 required'
    root.mkdir(parents=True, exist_ok=True)
    archive = root / 'sui-mainnet-v1.78.1-ubuntu-x86_64.tgz'
    download('https://github.com/MystenLabs/sui/releases/download/mainnet-v1.78.1/' + archive.name,
             archive, COMPILER_ARCHIVE_SHA256)
    compiler = root / 'sui'
    if not compiler.exists():
        with tarfile.open(archive, 'r:gz') as tar:
            entries = [m for m in tar.getmembers() if m.isfile() and Path(m.name).name == 'sui']
            assert len(entries) == 1, 'Ambiguous compiler archive'
            with tar.extractfile(entries[0]) as source, compiler.open('wb') as out:
                shutil.copyfileobj(source, out)
        compiler.chmod(0o755)
    assert sha256(compiler) == COMPILER_BINARY_SHA256, 'Compiler binary mismatch'

    framework_archive = root / f'framework-{FRAMEWORK_REVISION}.tar.gz'
    download('https://codeload.github.com/MystenLabs/sui/tar.gz/' + FRAMEWORK_REVISION,
             framework_archive, FRAMEWORK_ARCHIVE_SHA256)
    framework = root / f'framework-{FRAMEWORK_REVISION}'
    prefix = f'sui-{FRAMEWORK_REVISION}/crates/sui-framework/packages/'
    if not framework.exists():
        framework.mkdir()
        with tarfile.open(framework_archive, 'r:gz') as tar:
            for member in tar:
                if not member.name.startswith(prefix) or not member.isfile():
                    continue
                relative = Path(member.name[len(prefix):])
                assert not relative.is_absolute() and '..' not in relative.parts
                destination = framework / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, destination.open('wb') as out:
                    shutil.copyfileobj(source, out)
    identity = verify_framework_sources(framework, framework_archive)
    result = {'compiler': str(compiler), 'compiler_archive': str(archive),
              'compiler_binary_sha256': COMPILER_BINARY_SHA256,
              'compiler_archive_sha256': COMPILER_ARCHIVE_SHA256,
              'framework_dir': str(framework), 'framework_archive': str(framework_archive),
              'framework_archive_sha256': FRAMEWORK_ARCHIVE_SHA256,
              'framework_source_tree_sha256': identity['sha256']}
    (root / 'toolchain.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    main()
