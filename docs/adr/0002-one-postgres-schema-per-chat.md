# One Postgres schema per Chat, not shared tables

Each Chat's Dataset is loaded into its own Postgres schema (`chat_<uuid>`), and SQL Analysts query through a read-only role whose `search_path` is fixed to that schema. We rejected shared tables keyed by a dataset id: two users uploading `orders.csv` would collide, every generated query would need a dataset filter the LLM could forget, and isolation would depend on the model rather than the database.

## Consequences

- A Dataset can't be reused across Chats; each Chat re-uploads its files.
- Schemas accumulate indefinitely; a TTL cleanup job is future work.
- Re-uploading a file with the same name replaces that Table and re-profiles the Dataset.
