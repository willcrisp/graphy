"""Print an argon2 hash for ROADMAP_ADMIN_PASSWORD_HASH.

    uv run python scripts/hash_password.py

Reads the password from a no-echo prompt (or the first argument, if you accept
that it lands in your shell history). The plaintext is never stored anywhere.
"""

from __future__ import annotations

import getpass
import sys

from argon2 import PasswordHasher


def main() -> int:
    if len(sys.argv) > 2:
        print("usage: hash_password.py [password]", file=sys.stderr)
        return 2

    if len(sys.argv) == 2:
        password = sys.argv[1]
    else:
        password = getpass.getpass("Admin password: ")
        if password != getpass.getpass("Confirm: "):
            print("Passwords did not match.", file=sys.stderr)
            return 1

    if not password:
        print("Password must not be empty.", file=sys.stderr)
        return 1

    print(PasswordHasher().hash(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
