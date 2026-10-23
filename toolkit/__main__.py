import argparse

from .server import serve


def main():
    ap = argparse.ArgumentParser(prog='toolkit', description='ParaWorld Toolkit (launcher, exporter, remake)')
    ap.add_argument('--port', type=int, default=0, help='port of the local server (default: first free from 8420)')
    ap.add_argument('--no-browser', action='store_true', help='do not open the browser')
    a = ap.parse_args()
    # (an update asks for a restart: exit code 3 - the start files run the toolkit again)
    raise SystemExit(serve(a.port, not a.no_browser) or 0)


if __name__ == '__main__':
    main()
