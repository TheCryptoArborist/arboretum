"""Run legacy generators with deterministic UTF-8/LF text on every platform."""
import pathlib
import runpy
import sys

original_write = pathlib.Path.write_text
original_read = pathlib.Path.read_text


def write_text(self, data, encoding=None, errors=None, newline=None):
    return original_write(self, data, encoding=encoding or 'utf-8', errors=errors, newline='\n' if newline is None else newline)


def read_text(self, encoding=None, errors=None, newline=None):
    options = {'encoding': encoding or 'utf-8', 'errors': errors}
    if newline is not None:
        options['newline'] = newline
    return original_read(self, **options)


pathlib.Path.write_text = write_text
pathlib.Path.read_text = read_text
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
