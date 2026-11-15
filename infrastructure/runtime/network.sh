#!/bin/sh
set -eu
# Run only in the new Docker network namespace, never on the host.
test -f /.dockerenv
test "${WINGSLAB_NETWORK_NAMESPACE:-}" = isolated
iptables -P OUTPUT DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
ip6tables -P OUTPUT DROP
ip6tables -P INPUT DROP
ip6tables -P FORWARD DROP
# Block Docker's embedded DNS BEFORE the loopback allowance (no DNS exfiltration).
# Docker can DNAT port 53 to a high resolver port before OUTPUT filtering.
# Deny the resolver address itself, not just its original destination port.
iptables -A OUTPUT -d 127.0.0.11/32 -j REJECT
iptables -A OUTPUT -p udp --dport 53 -j REJECT
iptables -A OUTPUT -p tcp --dport 53 -j REJECT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
case "${WINGSLAB_NETWORK_ROLE:-}" in
  runtime)
    iptables -A OUTPUT -d 172.30.240.10 -p tcp --dport 5432 -j ACCEPT
    iptables -A OUTPUT -d 172.30.240.11 -p tcp --dport 6379 -j ACCEPT
    iptables -A INPUT -p tcp --dport 3100:3104 -j ACCEPT
    ;;
  postgres) iptables -A INPUT -s 172.30.240.20 -p tcp --dport 5432 -j ACCEPT ;;
  redis) iptables -A INPUT -s 172.30.240.20 -p tcp --dport 6379 -j ACCEPT ;;
  *) exit 1 ;;
esac
touch /run/wingslab-network-ready
while :; do sleep 3600; done
