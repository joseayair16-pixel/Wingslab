#!/bin/sh
# WingsLab edge relay: 3101 -> 172.30.240.21:3101 (backend API / Socket.IO).
# BusyBox nc -e accepts a single executable token, so each target has its own script.
exec nc -w 30 172.30.240.21 3101
