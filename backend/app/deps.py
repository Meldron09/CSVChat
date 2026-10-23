"""FastAPI dependencies shared by the routers."""

from fastapi import HTTPException, Request

from app import chats


def existing_chat(request: Request, chat_id: str) -> dict:
    """The Chat store row for the `{chat_id}` path parameter; 404 when there is none."""
    chat = chats.get_chat(request.app.state.settings, chat_id)
    if chat is None:
        raise HTTPException(404, "Chat not found")
    return chat
