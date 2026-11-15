#!/bin/sh
# WingsLab edge relay: 3102 -> 172.30.240.23:3102 (restaurant panel).
# BusyBox nc -e accepts a single executable token, so each target has its own script.
exec nc -w 30 172.30.240.23 3102
