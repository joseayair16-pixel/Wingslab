#!/bin/sh
# WingsLab edge relay: 3103 -> 172.30.240.22:3103 (customer app).
# BusyBox nc -e accepts a single executable token, so each target has its own script.
exec nc -w 30 172.30.240.22 3103
