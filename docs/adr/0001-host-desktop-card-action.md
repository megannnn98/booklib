# Distinguish host desktop from trusted LAN for card selection

Booklib treats a request whose TCP peer address equals the connection's local
address (the host connecting to itself) as a Host desktop client when Caddy adds a server-owned desktop marker. Only this client and a
direct loopback client may open the host file manager; a Trusted LAN client
retains administrative controls but selecting a card shows its downloadable
formats. This separates device locality from administrative authorization and
does not rely on a forgeable User-Agent. Absence of the desktop marker fails
closed to the format-selection UI rather than opening the host file manager.

Amendment 2026-10-30: the original matcher pinned host IPv4 `192.168.0.106`;
after a DHCP change the host fell into the Trusted LAN branch. The Caddy
matcher now compares `{http.request.remote.host}` with
`{http.request.local.host}`, which holds for any host address.
