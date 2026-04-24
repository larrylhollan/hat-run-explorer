#!/usr/bin/env python3
import os
import runpy
import sys

COORDINATOR = "/Users/larry/hat-workspace/coordinator.py"

if __name__ == "__main__":
    sys.argv = [COORDINATOR, *sys.argv[1:]]
    runpy.run_path(COORDINATOR, run_name="__main__")
