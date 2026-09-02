# Distinguish host desktop from trusted LAN for card selection

Booklib treats a request from stable host IPv4 `192.168.0.106` as a Host desktop
client when Caddy adds a server-owned desktop marker. Only this client and a
direct loopback client may open the host file manager; a Trusted LAN client
retains administrative controls but selecting a card shows its downloadable
formats. This separates device locality from administrative authorization and
does not rely on a forgeable User-Agent. Absence of the desktop marker fails
closed to the format-selection UI rather than opening the host file manager.
