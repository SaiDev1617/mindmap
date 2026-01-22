"""RAG (Retrieval-Augmented Generation) module for document querying."""

from .rag_pipeline import (
    build_or_load_index,
    make_advanced_query_engine,
    query_document,
    chat_with_document,
    get_chat_engine,
    reset_chat_memory,
    clear_index_cache,
)

__all__ = [
    "build_or_load_index",
    "make_advanced_query_engine", 
    "query_document",
    "chat_with_document",
    "get_chat_engine",
    "reset_chat_memory",
    "clear_index_cache",
]
