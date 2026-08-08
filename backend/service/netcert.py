# -*- coding: utf-8 -*-
"""Self-signed certificate for LAN access.

Why HTTPS is required: **browsers only grant microphone permission in a secure context**. Opening the page on a phone via
http://192.168.x.x makes getUserMedia flat-out unavailable—you don't even get a prompt.

And the original office-addin dev certificate was only signed for localhost, so accessing the LAN IP from a phone causes a hostname mismatch.
So here we sign our own, with the SAN listing localhost, 127.0.0.1, and all of this machine's LAN IPv4 addresses.
It re-signs automatically when the machine's IP changes (switching WiFi, plugging in Ethernet).
"""
import datetime
import ipaddress
import os
import socket

CERT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "certs")
CRT = os.path.join(CERT_DIR, "server.crt")
KEY = os.path.join(CERT_DIR, "server.key")
SANS_FILE = os.path.join(CERT_DIR, "sans.txt")


def lan_ips():
    """This machine's LAN IPv4 addresses."""
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    # the above misses some on certain networks, so use the "dial out and see which interface it uses" trick once more
    for probe in ("10.255.255.255", "192.168.1.1", "8.8.8.8"):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((probe, 1))
            ips.add(s.getsockname()[0])
        except Exception:
            pass
        finally:
            s.close()
    ips.discard("0.0.0.0")
    return sorted(i for i in ips if not i.startswith("169.254."))


def _sans_signature(ips):
    return ",".join(["localhost", "127.0.0.1"] + ips)


def ensure_cert():
    """Returns (crt, key, ips). Re-signs when the IP changes."""
    ips = lan_ips()
    sig = _sans_signature(ips)
    if os.path.exists(CRT) and os.path.exists(KEY) and os.path.exists(SANS_FILE):
        with open(SANS_FILE, encoding="utf-8") as f:
            if f.read().strip() == sig:
                return CRT, KEY, ips

    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    os.makedirs(CERT_DIR, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "课堂实时字幕"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "local"),
    ])
    alts = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.IPv4Address("127.0.0.1"))]
    for ip in ips:
        try:
            alts.append(x509.IPAddress(ipaddress.IPv4Address(ip)))
        except Exception:
            pass
    now = datetime.datetime.utcnow()
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName(alts), critical=False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))

    with open(KEY, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM,
                                  serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
    with open(CRT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(SANS_FILE, "w", encoding="utf-8") as f:
        f.write(sig)
    return CRT, KEY, ips
