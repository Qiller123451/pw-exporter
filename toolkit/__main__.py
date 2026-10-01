import argparse

from .server import serve


def main():
    ap = argparse.ArgumentParser(prog='toolkit', description='ParaWorld Toolkit (launcher, exporter, remake)')
    ap.add_argument('--port', type=int, default=0, help='port of the local server (default: first free from 8420)')
    ap.add_argument('--no-browser', action='store_true', help='do not open the browser')
    a = ap.parse_args()
    serve(a.port, not a.no_browser)


if __name__ == '__main__':
    main()
