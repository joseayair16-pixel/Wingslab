#!/bin/sh
# WingsLab edge relay: 16379 -> 172.30.240.11:6379 (Redis (host tooling)).
# BusyBox nc -e accepts a single executable token, so each target has its own script.
exec nc -w 30 172.30.240.11 6379
