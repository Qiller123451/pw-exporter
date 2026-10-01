"""python -m pwexport              start the Model & Map Exporter app
python -m pwexport --help       options (port, no browser)
python -m pwexport.cli --help   command line export (batch, scripts)"""
import argparse

from .app import serve


def main():
    ap = argparse.ArgumentParser(prog='pwexport', description='ParaWorld Model & Map Exporter')
    ap.add_argument('--port', type=int, default=0, help='port of the local server (default: first free from 8420)')
    ap.add_argument('--no-browser', action='store_true', help='do not open the browser')
    a = ap.parse_args()
    serve(a.port, not a.no_browser)


if __name__ == '__main__':
    main()
