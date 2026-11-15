#!/bin/sh
# WingsLab edge forwarder.
#
# Docker does not publish ports of `internal` networks, so this container is the
# only component on a routable network. It holds NO application code and NO
# credentials: it only relays TCP to fixed addresses inside the isolated network.
#
# BusyBox nc can only execute a single token with -e, so each relay target has
# its own wrapper script under /edge/. This script only starts them.
set -eu
for script in /edge/relay-*.sh; do
  listen_port=${script#/edge/relay-}
  listen_port=${listen_port%.sh}
  nc -lk -p "$listen_port" -e "$script" >/dev/null 2>&1 &
done
wait
