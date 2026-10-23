from langchain_core.language_models import BaseChatModel
from langchain_ollama import ChatOllama

from app.settings import Settings


def build_model(settings: Settings) -> BaseChatModel:
    """The single place the chat model is constructed. Tests inject a scripted fake via create_app(model_factory=...)."""
    return ChatOllama(model=settings.ollama_model, base_url=settings.ollama_base_url)
