# Booklib

Booklib indexes a host computer's read-only book library and exposes a catalogue
to local and trusted LAN clients.

## Language

**Host desktop client**:
A browser running on the host computer, whether it reaches Booklib directly by
loopback or through the host's Caddy address. It is the only client type for
which a card selection may open the host file manager. Caddy proves the
non-loopback case with its server-owned desktop marker for connections whose
peer address equals the local address, independent of the DHCP lease.
_Avoid_: loopback client, local client, admin client

**Trusted LAN client**:
A client admitted by the trusted-network proxy policy. It may be authorized for
administrative UI operations, but it is never a host desktop client. It retains
administrative UI controls and selects a book to obtain download links.
_Avoid_: local client, remote desktop

**Guest client**:
A non-trusted network client. It may read the catalogue and download a listed
book file, but cannot use administrative operations.

**Section**:
The single shelf a book card belongs to. Every card has exactly one section;
a manual section edit outranks the classified one.
_Avoid_: category, tag

**Tag**:
A label used to filter the catalogue. A card may carry any number of tags,
each of one kind (form, technology, topic, language, person, period, custom).
Tags filter; they do not order the catalogue.
_Avoid_: section, category

**Automatic tag**:
A tag assignment derived from tag rules. It is recomputed on every rescan and
on explicit request, so it always reflects the current rules; it can only be
removed by changing the rules.
_Avoid_: suggested tag

**Manual tag**:
A tag assignment made by a person. Recomputing automatic tags never removes
it, and editing manual tags never removes automatic ones.

**Format selection**:
The file-choice list shown when a Trusted LAN client selects a book. It exposes
each available format before the client initiates a download. It is also the
fail-closed action when a client has no verified host-desktop marker.
_Avoid_: automatic download, open book
