#!/bin/sh
# WingsLab edge forwarder.
#
# Docker does not publish ports of `internal` networks, so this container is the
# only component on a routable network. It holds NO application code and NO
# credentials: it only relays TCP to fixed addresses inside the isolated network.
#
# Listen only on the ingress interface, never on the internal service network.
# Only data tooling, backend, customer and restaurant are authorized.
# Driver listener stays closed.
# BusyBox nc -e requires one executable token per target.
set -eu
children=''
trap 'kill $children 2>/dev/null || true; wait; exit 0' TERM INT
for listen_port in 15432 16379 3101 3103 3102; do
  nc -lk -s 172.31.240.10 -p "$listen_port" -e "/edge/relay-$listen_port.sh" &
  children="$children $!"
done
wait
