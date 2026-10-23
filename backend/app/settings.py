import os
from dataclasses import dataclass

OWNER_ROLE = "csvchat_owner"
READONLY_ROLE = "csvchat_readonly"


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: str
    db_name: str
    owner_password: str
    readonly_password: str
    ollama_model: str
    ollama_base_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ.get
        return cls(
            db_host=env("POSTGRES_HOST", "localhost"),
            db_port=env("POSTGRES_PORT", "55432"),
            db_name=env("POSTGRES_DB", "csvchat"),
            owner_password=env("DB_OWNER_PASSWORD", "owner"),
            readonly_password=env("DB_READONLY_PASSWORD", "readonly"),
            ollama_model=env("OLLAMA_MODEL", "gpt-oss:20b-cloud"),
            ollama_base_url=env("OLLAMA_BASE_URL", "http://localhost:11434"),
        )

    def _dsn(self, role: str, password: str) -> str:
        return f"host={self.db_host} port={self.db_port} dbname={self.db_name} user={role} password={password}"

    @property
    def owner_dsn(self) -> str:
        return self._dsn(OWNER_ROLE, self.owner_password)

    @property
    def readonly_dsn(self) -> str:
        return self._dsn(READONLY_ROLE, self.readonly_password)
