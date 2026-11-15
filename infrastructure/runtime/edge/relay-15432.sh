#!/bin/sh
# WingsLab edge relay: 15432 -> 172.30.240.10:5432 (PostgreSQL (host tooling)).
# BusyBox nc -e accepts a single executable token, so each target has its own script.
exec nc -w 30 172.30.240.10 5432
