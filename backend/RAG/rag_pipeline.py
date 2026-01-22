"""
RAG Pipeline for document indexing and querying.

This module provides functions to:
1. Build/load a vector index for a document stored in local_storage
2. Query the index using hybrid retrieval (vector + BM25) with LLM reranking
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any
import chromadb

from llama_index.core import Settings, StorageContext, VectorStoreIndex, load_index_from_storage
from llama_index.core import SimpleDirectoryReader
from llama_index.llms.openai import OpenAI
from llama_index.embeddings.openai import OpenAIEmbedding

from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.retrievers.bm25 import BM25Retriever
from llama_index.core.retrievers import QueryFusionRetriever
from llama_index.core.postprocessor import LLMRerank
from llama_index.core.query_engine import RetrieverQueryEngine, TransformQueryEngine, RetryQueryEngine, CitationQueryEngine
from llama_index.core.evaluation import RelevancyEvaluator
from llama_index.core.indices.query.query_transform import HyDEQueryTransform
from llama_index.core.memory import ChatMemoryBuffer
from llama_index.core.chat_engine import CondensePlusContextChatEngine
from llama_index.core.base.llms.types import ChatMessage, MessageRole
from dotenv import load_dotenv

load_dotenv()

# -----------------------------
# Global model config (OpenAI only)
# -----------------------------
Settings.llm = OpenAI(model="gpt-4.1")  # change as needed
Settings.embed_model = OpenAIEmbedding(model="text-embedding-3-large")

# Base directory for local storage (where files are uploaded)
LOCAL_STORAGE_BASE = Path(__file__).parent.parent / "local_storage"

# In-memory cache for loaded indices and query engines
_index_cache: Dict[str, VectorStoreIndex] = {}
_query_engine_cache: Dict[str, Any] = {}
_chat_engine_cache: Dict[str, Any] = {}
_chat_memory_cache: Dict[str, ChatMemoryBuffer] = {}


def _paths_for_id(doc_id: str) -> dict:
    """
    Get paths for RAG storage within the document's local_storage folder.
    
    Args:
        doc_id: The UUID of the document (folder name in local_storage)
    
    Returns:
        dict: Paths for base folder, chroma DB, and index storage
    """
    base = LOCAL_STORAGE_BASE / doc_id / "rag_storage"
    return {
        "base": base,
        "chroma": base / "chroma",
        "index": base / "index",  # llamaindex docstore/index_store
        "doc_folder": LOCAL_STORAGE_BASE / doc_id,  # parent folder with source documents
    }


def build_or_load_index(doc_id: str, input_dir: Optional[str] = None) -> VectorStoreIndex:
    """
    Build or load a vector index for a document.
    
    If the index already exists in the document's rag_storage folder, it will be loaded.
    Otherwise, a new index will be created from the documents in the input directory.
    
    Args:
        doc_id: The UUID of the document (folder name in local_storage)
        input_dir: Optional path to input directory. If None, uses the doc's local_storage folder.
    
    Returns:
        VectorStoreIndex: The loaded or newly created index
    """
    # Check cache first
    if doc_id in _index_cache:
        return _index_cache[doc_id]
    
    p = _paths_for_id(doc_id)
    p["chroma"].mkdir(parents=True, exist_ok=True)
    p["index"].mkdir(parents=True, exist_ok=True)

    # If already persisted, load it
    if any(p["index"].iterdir()):
        
        # Load Chroma collection
        chroma_client = chromadb.PersistentClient(path=str(p["chroma"]))
        collection = chroma_client.get_or_create_collection(name=f"rag_{doc_id}")
        vector_store = ChromaVectorStore(chroma_collection=collection)
        
        storage_context = StorageContext.from_defaults(
            persist_dir=str(p["index"]),
            vector_store=vector_store
        )
        index = load_index_from_storage(storage_context)
        _index_cache[doc_id] = index
        return index

    # Use provided input_dir or default to the document's local_storage folder
    if input_dir is None:
        input_dir = str(p["doc_folder"])
    
    # ---- Ingest documents
    # SimpleDirectoryReader supports .pdf/.docx/.txt/.md and more
    documents = SimpleDirectoryReader(
        input_dir, 
        recursive=False,
        exclude=["metadata.json", "*.json"],  # Exclude JSON files
        file_extractor={},  # Use default extractors
    ).load_data()

    # ---- Local Chroma per ID
    chroma_client = chromadb.PersistentClient(path=str(p["chroma"]))
    collection = chroma_client.get_or_create_collection(name=f"rag_{doc_id}")
    vector_store = ChromaVectorStore(chroma_collection=collection)

    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    index = VectorStoreIndex.from_documents(documents, storage_context=storage_context)

    # Persist llamaindex docstore/index metadata under ./local_storage/{doc_id}/rag_storage/index
    index.storage_context.persist(persist_dir=str(p["index"]))
    
    # Cache the index
    _index_cache[doc_id] = index
    print(f"[RAG] Index built and persisted for {doc_id}")
    
    

def make_advanced_query_engine(index: VectorStoreIndex, doc_id: Optional[str] = None):
    """
    Create an advanced query engine with hybrid retrieval and LLM reranking.
    
    Features:
    - Vector retrieval (semantic search)
    - BM25 retrieval (lexical/keyword search)
    - Query fusion (combines both approaches)
    - LLM reranking (improves result quality)
    - HyDE query transformation (hypothetical document embeddings)
    - Retry on low relevance
    
    Args:
        index: The VectorStoreIndex to query
        doc_id: Optional document ID for caching
    
    Returns:
        Query engine ready for use
    """
    # Check cache if doc_id provided
    if doc_id and doc_id in _query_engine_cache:
        print(f"[RAG] Using cached query engine for {doc_id}")
        
    # Vector retriever
    vector_retriever = index.as_retriever(similarity_top_k=10)

    # BM25 retriever (lexical) - only use if docstore has nodes
    nodes = list(index.docstore.docs.values())
    if len(nodes) > 0:
        bm25_retriever = BM25Retriever.from_defaults(docstore=index.docstore, similarity_top_k=10)
        retrievers = [vector_retriever, bm25_retriever]
        print(f"[RAG] Using hybrid retrieval (vector + BM25) with {len(nodes)} nodes")
    else:
        retrievers = [vector_retriever]
    # Fusion retriever (hybrid) — reciprocal_rerank is a good "low-tuning" default
    fusion_retriever = QueryFusionRetriever(
        retrievers=retrievers,
        similarity_top_k=10,
        num_queries=4,  # query generation for fusion (set 1 to disable)
        mode="reciprocal_rerank",
        use_async=True,
    )

    # LLM rerank using OpenAI model
    reranker = LLMRerank(top_n=6, llm=Settings.llm)

    # Use CitationQueryEngine for inline citations [1], [2], etc.
    citation_engine = CitationQueryEngine.from_args(
        index,
        retriever=fusion_retriever,
        node_postprocessors=[reranker],
        citation_chunk_size=512,
        response_mode="compact",  # or "tree_summarize" for more synthesis
    )

    # Optional: HyDE transform (helps for vague/intent-heavy short queries)
    hyde = HyDEQueryTransform(include_original=True)
    hyde_engine = TransformQueryEngine(citation_engine, query_transform=hyde)

    # Optional: Retry if answer is judged low relevance
    evaluator = RelevancyEvaluator()
    retry_engine = RetryQueryEngine(hyde_engine, evaluator, max_retries=2)

    # Cache if doc_id provided
    if doc_id:
        _query_engine_cache[doc_id] = retry_engine
        
    return retry_engine


def query_document(doc_id: str, query: str) -> dict:
    """
    Query a document using RAG (single query, no history).
    
    This is the main entry point for chat/query functionality.
    It loads/builds the index and runs the query through the advanced query engine.
    
    Args:
        doc_id: The UUID of the document (folder name in local_storage)
        query: The user's question/query
    
    Returns:
        dict: Contains 'response' (answer text), 'sources' (list of source chunks), and 'formatted_sources'
    """
    # Build or load the index
    index = build_or_load_index(doc_id)
    
    # Get the query engine
    query_engine = make_advanced_query_engine(index, doc_id)
    
    # Execute the query
    response = query_engine.query(query)
    
    # Extract source information
    sources = []
    if hasattr(response, 'source_nodes'):
        for i, node in enumerate(response.source_nodes):
            sources.append({
                "index": i + 1,
                "text": node.node.get_content()[:500],  # Truncate for brevity
                "score": node.score if hasattr(node, 'score') else None,
            })
    
    # Get formatted sources if available (from CitationQueryEngine)
    formatted_sources = ""
    if hasattr(response, 'get_formatted_sources'):
        try:
            formatted_sources = response.get_formatted_sources()
        except:
            pass
    
    return {
        "response": str(response),
        "sources": sources,
        "formatted_sources": formatted_sources
    }


def get_chat_engine(doc_id: str) -> CondensePlusContextChatEngine:
    """
    Get or create a chat engine with conversation memory for a document.
    
    This chat engine:
    - Maintains conversation history
    - Condenses follow-up questions with context
    - Uses the hybrid retriever for relevant context
    
    Args:
        doc_id: The UUID of the document
    
    Returns:
        CondensePlusContextChatEngine: Chat engine with memory
    """
    # Check cache first
    if doc_id in _chat_engine_cache:
        return _chat_engine_cache[doc_id]
    
    # Build or load the index
    index = build_or_load_index(doc_id)
    
    # Build retriever (same as query engine)
    vector_retriever = index.as_retriever(similarity_top_k=10)
    nodes = list(index.docstore.docs.values())
    
    if len(nodes) > 0:
        bm25_retriever = BM25Retriever.from_defaults(docstore=index.docstore, similarity_top_k=10)
        retrievers = [vector_retriever, bm25_retriever]
    else:
        retrievers = [vector_retriever]
    
    fusion_retriever = QueryFusionRetriever(
        retrievers=retrievers,
        similarity_top_k=10,
        num_queries=4,
        mode="reciprocal_rerank",
        use_async=True,
    )
    
    # Create memory buffer for conversation history
    memory = ChatMemoryBuffer.from_defaults(token_limit=4096)
    _chat_memory_cache[doc_id] = memory
    
    # LLM rerank using OpenAI model
    reranker = LLMRerank(top_n=6, llm=Settings.llm)
    
    # Use CitationQueryEngine for inline citations [1], [2], etc.
    citation_engine = CitationQueryEngine.from_args(
        index,
        retriever=fusion_retriever,
        node_postprocessors=[reranker],
        citation_chunk_size=512,
        response_mode="compact",
    )
    
    # Create chat engine with citation query engine
    chat_engine = CondensePlusContextChatEngine.from_defaults(
        retriever=fusion_retriever,
        query_engine=citation_engine,
        memory=memory,
        llm=Settings.llm,
        verbose=True,
    )
    
    _chat_engine_cache[doc_id] = chat_engine
    print(f"[RAG] Created new chat engine with citations for {doc_id}")
    
    

def chat_with_document(doc_id: str, message: str, chat_history: list = None) -> dict:
    """
    Conversational chat with a document, maintaining history.
    
    Uses CitationQueryEngine directly to ensure proper citation formatting.
    Manually handles conversation context by prepending history to the query.
    
    Args:
        doc_id: The UUID of the document (folder name in local_storage)
        message: The user's new message
        chat_history: Optional list of previous messages [{"role": "user"|"assistant", "content": str}]
    
    Returns:
        dict: Contains 'response' (answer text), 'sources' (list of source chunks)
    """
    print(f"[RAG] Chat with document {doc_id}: {message[:100]}...")
    index = build_or_load_index(doc_id)
    
    # Get the citation query engine (not cached to avoid stale context)
    vector_retriever = index.as_retriever(similarity_top_k=10)
    nodes = list(index.docstore.docs.values())
    
    if len(nodes) > 0:
        bm25_retriever = BM25Retriever.from_defaults(docstore=index.docstore, similarity_top_k=10)
        retrievers = [vector_retriever, bm25_retriever]
    else:
        retrievers = [vector_retriever]
    
    fusion_retriever = QueryFusionRetriever(
        retrievers=retrievers,
        similarity_top_k=8,  # Reduced for tighter citation mapping
        num_queries=4,
        mode="reciprocal_rerank",
        use_async=True,
    )
    
    reranker = LLMRerank(top_n=6, llm=Settings.llm)
    
    # CitationQueryEngine for inline citations with tighter chunk mapping
    citation_engine = CitationQueryEngine.from_args(
        index,
        retriever=fusion_retriever,
        node_postprocessors=[reranker],
        citation_chunk_size=512,  # Smaller chunks = tighter citation-to-claim mapping
        similarity_top_k=8,
        response_mode="compact",
    )
    
    # Build contextualized query with citation instructions
    if chat_history and len(chat_history) > 1:
        # Create context from recent messages (last 3 exchanges)
        recent_history = chat_history[-6:-1] if len(chat_history) > 6 else chat_history[:-1]
        context_parts = []
        for msg in recent_history:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "user":
                context_parts.append(f"Previous question: {content}")
            elif role == "assistant":
                context_parts.append(f"Previous answer: {content[:200]}...")
        
        if context_parts:
            conversation_context = "\n".join(context_parts)
            contextualized_query = f"""Given this conversation context:
{conversation_context}

Current question: {message}

Please answer the current question, using inline citations like [1], [2] for any facts from the document."""
            print(f"[RAG] Using contextualized query with {len(recent_history)} previous messages")
        else:
            # No meaningful context, just add citation instruction
            contextualized_query = f"{message}\n\nPlease use inline citations like [1], [2] for any facts from the document."
    else:
        # First message - add citation instruction
        contextualized_query = f"{message}\n\nPlease use inline citations like [1], [2] for any facts from the document."
    
    response = citation_engine.query(contextualized_query)
    
    # Extract source information
    sources = []
    response_text = str(response)  # Keep citations like [1], [2] in the text
    
    if hasattr(response, 'source_nodes') and response.source_nodes:
        # Extract sources with full content
        for i, node in enumerate(response.source_nodes):
            sources.append({
                "index": i + 1,
                "text": node.node.get_content(),
                "score": float(node.score) if hasattr(node, 'score') and node.score is not None else None,
            })
        print(f"[RAG] Got response with {len(sources)} sources and inline citations")
        print(f"[RAG] Response text preview: {response_text[:200]}...")
        print(f"[RAG] First source preview: {sources[0]['text'][:100]}..." if sources else "[RAG] No sources")
    
    return {
        "response": response_text,
        "sources": sources
    }


def reset_chat_memory(doc_id: str):
    """
    Reset the chat memory for a document (start fresh conversation).
    
    Args:
        doc_id: The UUID of the document
    """
    if doc_id in _chat_memory_cache:
        _chat_memory_cache[doc_id].reset()
        print(f"[RAG] Reset chat memory for {doc_id}")
    
    _chat_engine_cache.pop(doc_id, None)


def clear_index_cache(doc_id: Optional[str] = None):
    """
    Clear the index cache for a specific document or all documents.
    
    Args:
        doc_id: Optional document ID. If None, clears all caches.
    """
    global _index_cache, _query_engine_cache, _chat_engine_cache, _chat_memory_cache
    
    if doc_id:
        _index_cache.pop(doc_id, None)
        _query_engine_cache.pop(doc_id, None)
        _chat_engine_cache.pop(doc_id, None)
        _chat_memory_cache.pop(doc_id, None)
        print(f"[RAG] Cleared cache for {doc_id}")
    else:
        _index_cache.clear()
        _query_engine_cache.clear()
        _chat_engine_cache.clear()
        _chat_memory_cache.clear()


# -----------------------------
# Usage / CLI
# -----------------------------
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="RAG Pipeline for document querying")
    parser.add_argument(
        "--doc-id",
        type=str,
        required=True,
        help="Document ID (UUID folder name in local_storage)"
    )
    parser.add_argument(
        "--input-dir",
        type=str,
        default=None,
        help="Optional: Override input directory for document ingestion"
    )
    parser.add_argument(
        "--query",
        type=str,
        default=None,
        help="Query to run (if not provided, enters interactive mode)"
    )
    args = parser.parse_args()

    # Build or load the index
    idx = build_or_load_index(args.doc_id, args.input_dir)
    qe = make_advanced_query_engine(idx, args.doc_id)

    if args.query:
        # Single query mode
        response = query_document(args.doc_id, args.query)
        
        # Display response
        if response.get("response"):
            print("Response:", response.get("response"))
    else:
        # Interactive mode
        while True:
            query = input("Query: ").strip()
            if query.lower() == "exit":
                break
            response = query_document(args.doc_id, query)
            if response.get("response"):
                print("Response:", response.get("response"))
