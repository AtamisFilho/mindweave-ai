"""Criptografia das chaves de API em repouso (Fernet).

Master key: derivada de ENCRYPTION_SECRET (.env) via SHA-256; se ausente,
gera e persiste um segredo próprio em backend/data/secret.key (gitignored).

Honestidade de ameaça: protege contra leak acidental do .db/dumps; NÃO
protege contra atacante com acesso à máquina (a master key está ao lado).
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
_SECRET_FILE = os.path.join(_DATA_DIR, "secret.key")


def _load_master_key() -> bytes:
    secret = (settings.ENCRYPTION_SECRET or "").strip()
    if secret:
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    else:
        os.makedirs(_DATA_DIR, exist_ok=True)
        if os.path.exists(_SECRET_FILE):
            with open(_SECRET_FILE, "rb") as f:
                key = f.read().strip()
        else:
            key = Fernet.generate_key()
            with open(_SECRET_FILE, "wb") as f:
                f.write(key)
    try:
        Fernet(key)
    except (ValueError, InvalidToken) as exc:
        raise RuntimeError(
            "ENCRYPTION_SECRET inválida: use uma string arbitrária (derivamos a "
            "master via SHA-256) ou remova a variável para gerar segredo local."
        ) from exc
    return key


_fernet_instance = None


def _fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        _fernet_instance = Fernet(_load_master_key())
    return _fernet_instance


def encrypt(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(token: bytes) -> str:
    return _fernet().decrypt(token).decode("utf-8")
