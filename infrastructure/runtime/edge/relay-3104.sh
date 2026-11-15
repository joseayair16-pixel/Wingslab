#!/bin/sh
# WingsLab edge relay: 3104 -> 172.30.240.24:3104 (driver app).
# BusyBox nc -e accepts a single executable token, so each target has its own script.
exec nc -w 30 172.30.240.24 3104
