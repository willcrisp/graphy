"""Environment parsing with fail-fast validation.

Required variables have no fallbacks. If one is missing the process refuses to
start and names the variable, rather than silently generating a secret that would
invalidate every session on the next restart.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REQUIRED = ("ROADMAP_SECRET_KEY", "ROADMAP_ADMIN_PASSWORD")

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}


class ConfigError(RuntimeError):
    """Raised at startup when the environment is not usable."""


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise ConfigError(
        f"{name} must be one of true/false (got {raw!r})"
    )


@dataclass(frozen=True)
class Settings:
    secret_key: str
    admin_password: str
    db_path: Path
    readonly: bool
    secure_cookies: bool
    static_dir: Path | None

    @property
    def db_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.db_path}"


def load_settings() -> Settings:
    """Read and validate the environment. Raises ConfigError on any problem."""
    missing = [name for name in REQUIRED if not os.environ.get(name, "").strip()]
    if missing:
        raise ConfigError(
            "Missing required environment variable(s): "
            + ", ".join(missing)
            + ". See .env.example."
        )

    db_path = Path(os.environ.get("ROADMAP_DB_PATH", "./blueprint.db")).expanduser()
    if not db_path.is_absolute():
        db_path = (Path.cwd() / db_path).resolve()

    static_raw = os.environ.get("ROADMAP_STATIC_DIR", "").strip()
    static_dir = Path(static_raw).expanduser().resolve() if static_raw else None
    if static_dir is not None and not static_dir.is_dir():
        raise ConfigError(
            f"ROADMAP_STATIC_DIR points at {static_dir}, which is not a directory. "
            "Build the frontend first (npm run build) or unset the variable."
        )

    return Settings(
        secret_key=os.environ["ROADMAP_SECRET_KEY"].strip(),
        admin_password=os.environ["ROADMAP_ADMIN_PASSWORD"],
        db_path=db_path,
        readonly=_flag("ROADMAP_READONLY"),
        secure_cookies=_flag("ROADMAP_SECURE_COOKIES"),
        static_dir=static_dir,
    )
