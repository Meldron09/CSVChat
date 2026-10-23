import os
from dataclasses import dataclass

OWNER_ROLE = "csvchat_owner"


@dataclass(frozen=True)
class Settings:
    db_host: str
    db_port: str
    db_name: str
    owner_password: str
    chat_role_secret: str  # derives each Chat role's password (see chats.chat_dsn)
    sql_timeout_ms: int
    ollama_model: str
    ollama_base_url: str
    upload_dir: str
    max_upload_bytes: int

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ.get
        return cls(
            db_host=env("POSTGRES_HOST", "localhost"),
            db_port=env("POSTGRES_PORT", "55432"),
            db_name=env("POSTGRES_DB", "csvchat"),
            owner_password=env("DB_OWNER_PASSWORD", "owner"),
            chat_role_secret=env("DB_CHAT_ROLE_SECRET", "dev-chat-role-secret"),
            sql_timeout_ms=int(env("SQL_TIMEOUT_MS", "10000")),
            ollama_model=env("OLLAMA_MODEL", "gpt-oss:20b-cloud"),
            ollama_base_url=env("OLLAMA_BASE_URL", "http://localhost:11434"),
            upload_dir=env("UPLOAD_DIR", "./data/uploads"),  # raw uploads, kept untouched
            max_upload_bytes=int(env("MAX_UPLOAD_BYTES", str(200 * 1024 * 1024))),
        )

    def dsn(self, role: str, password: str) -> str:
        return f"host={self.db_host} port={self.db_port} dbname={self.db_name} user={role} password={password}"

    @property
    def owner_dsn(self) -> str:
        return self.dsn(OWNER_ROLE, self.owner_password)
