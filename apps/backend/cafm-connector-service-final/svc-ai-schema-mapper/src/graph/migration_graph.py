"""LangGraph state machine construction for svc-AI-Schema-Mapper.

9-node migration pipeline with PostgreSQL checkpointer and HITL interrupt gates.
"""

import logging
from typing import Any, Callable

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

# Try to import the postgres checkpointer (requires langgraph-checkpoint-postgres + psycopg3)
try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver as _AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool as _AsyncConnectionPool
except ImportError:
    _AsyncPostgresSaver = None
    _AsyncConnectionPool = None

try:
    from langgraph.checkpoint.postgres import PostgresSaver as _SyncPostgresSaver
except ImportError:
    _SyncPostgresSaver = None

from .state import MigrationState
from ..db import get_sync_db_url
from .nodes.ingest_node import ingest_node
from .nodes.deterministic_mapper import deterministic_mapper_node
from .nodes.pre_semantic_review_node import pre_semantic_review_node
from .nodes.semantic_mapper import semantic_mapper_node
from .nodes.human_review_node import human_review_node
from .nodes.preprocess_node import preprocess_node
from .nodes.hierarchy_node import hierarchy_node
from .nodes.verify_hierarchy_node import verify_hierarchy_node
from .nodes.output_generator_node import output_generator_node
from .nodes.write_node import write_node

from cafm_shared.logging import get_logger
logger = get_logger(__name__)


# ── Node implementations are now imported from .nodes modules ──────────────
# All 9 nodes are fully implemented in Phase 3-6


# ── Conditional Edge Functions ────────────────────────────────────────────────

def _should_skip_semantic_mapper(state: MigrationState) -> str:
    """
    After the Pre-Semantic Review Gate:
    - Count total unresolved fields across all tables (includes any fields that
      were rejected at the pre-semantic gate and pushed back to unresolved).
    - If none remain → skip Node 3, go to Node 5 (preprocess).
    - Otherwise → proceed to Node 3 (semantic_mapper).
    """
    unresolved_by_table: dict = state.get("unresolved_by_table", {})
    total_unresolved = sum(len(fields) for fields in unresolved_by_table.values())
    if total_unresolved == 0:
        logger.info("[Pre-Semantic→5] No unresolved fields after pre-semantic gate; skipping semantic mapper")
        return "preprocess_node"
    logger.info(f"[Pre-Semantic→3] {total_unresolved} unresolved fields; proceeding to semantic mapper")
    return "semantic_mapper_node"


def _route_after_semantic(state: MigrationState) -> str:
    """
    After Node 3 (semantic_mapper):
    - EL-3.0: If overall_confidence < 0.80 → FORCE GATE 1 (human_review_node)
    - Else if tier2_flagged_by_table has any entries → GATE 1 (human_review_node)
    - Otherwise → proceed to Node 5 (preprocess_node)
    """
    overall_confidence = state.get("overall_confidence", 1.0)
    flagged_by_table: dict = state.get("tier2_flagged_by_table", {})
    total_flagged = sum(len(items) for items in flagged_by_table.values())

    # EL-3.0: Force GATE 1 if confidence too low
    if overall_confidence < 0.80:
        logger.warning(
            f"[EL-3.0] overall_confidence={overall_confidence:.2f} < 0.80; "
            f"FORCING GATE 1 (human_review_node)"
        )
        return "human_review_node"

    # If customer must review flagged fields
    if total_flagged > 0:
        logger.info(
            f"[Node 3→4] {total_flagged} fields flagged for review; "
            f"proceeding to GATE 1 (human_review_node)"
        )
        return "human_review_node"

    # All fields mapped and confident
    logger.info(f"[Node 3→5] All fields mapped confidently; skipping GATE 1")
    return "preprocess_node"


def build_migration_graph(
    checkpointer: Any,
) -> Any:
    """
    Construct and compile the 9-node StateGraph.

    Args:
        checkpointer: PostgresSaver instance for state persistence

    Returns:
        Compiled StateGraph ready for astream_events() / ainvoke()
    """

    # Create the StateGraph
    graph = StateGraph(MigrationState)

    # ── Register all nodes ────────────────────────────────────────────
    graph.add_node("ingest_node", ingest_node)
    graph.add_node("deterministic_mapper_node", deterministic_mapper_node)
    graph.add_node("pre_semantic_review_node", pre_semantic_review_node)  # new gate
    graph.add_node("semantic_mapper_node", semantic_mapper_node)
    graph.add_node("human_review_node", human_review_node)
    graph.add_node("preprocess_node", preprocess_node)
    graph.add_node("hierarchy_node", hierarchy_node)
    graph.add_node("verify_hierarchy_node", verify_hierarchy_node)
    graph.add_node("output_generator_node", output_generator_node)
    graph.add_node("write_node", write_node)

    # ── Connect edges (START → Node 1, then chain) ────────────────────
    graph.add_edge(START, "ingest_node")
    graph.add_edge("ingest_node", "deterministic_mapper_node")

    # Node 2 → Pre-Semantic Gate (always — gate skips itself if nothing reviewable)
    graph.add_edge("deterministic_mapper_node", "pre_semantic_review_node")

    # Conditional: Pre-Semantic Gate → Node 3 or Node 5?
    # (unresolved_by_table now includes any fields rejected at the gate)
    graph.add_conditional_edges(
        "pre_semantic_review_node",
        _should_skip_semantic_mapper,
        {
            "semantic_mapper_node": "semantic_mapper_node",
            "preprocess_node": "preprocess_node",
        },
    )

    # Conditional: Node 3 → 4 (GATE 1) or 5?
    graph.add_conditional_edges(
        "semantic_mapper_node",
        _route_after_semantic,
        {
            "human_review_node": "human_review_node",
            "preprocess_node": "preprocess_node",
        },
    )

    # If customer approved/rejected in GATE 1, continue
    graph.add_edge("human_review_node", "preprocess_node")

    # Continue: Node 5 → 6 → 7 → 8 → 9 → END
    graph.add_edge("preprocess_node", "hierarchy_node")
    graph.add_edge("hierarchy_node", "verify_hierarchy_node")
    graph.add_edge("verify_hierarchy_node", "output_generator_node")
    graph.add_edge("output_generator_node", "write_node")
    graph.add_edge("write_node", END)

    # Nodes that should pause after completion so the user can review output
    # before the pipeline advances.  Gate nodes (pre_semantic_review_node,
    # human_review_node, verify_hierarchy_node, write_node) already use
    # interrupt() internally — they are NOT listed here to avoid double-pausing.
    _STEP_NODES = [
        "ingest_node",
        "deterministic_mapper_node",
        "semantic_mapper_node",
        "preprocess_node",
        "hierarchy_node",
        "output_generator_node",
    ]

    # Compile with checkpointer (or None for memory-only)
    if checkpointer:
        logger.info("Compiling StateGraph with PostgreSQL checkpointer (interrupt_after=step nodes)")
    else:
        logger.warning("Compiling StateGraph WITHOUT checkpointer (memory-only)")
    compiled_graph = (
        graph.compile(checkpointer=checkpointer, interrupt_after=_STEP_NODES)
        if checkpointer
        else graph.compile(interrupt_after=_STEP_NODES)
    )

    return compiled_graph


async def get_migration_graph() -> Any:
    """
    Factory function: Build the migration graph with a checkpointer.

    Priority:
      1. AsyncPostgresSaver  (Linux/Mac — psycopg3 async pool requires SelectorEventLoop)
      2. SyncPostgresSaver   (Windows dev — psycopg2, no event-loop restrictions)
      3. MemorySaver         (always available — state lost on process restart)

    Called once at app startup via the lifespan context manager (async).
    """
    import sys as _sys
    checkpointer = None
    sync_db_url = get_sync_db_url()

    # ── Option 1: async postgres checkpointer (non-Windows only) ──────────
    # On Windows the default ProactorEventLoop breaks psycopg3's async pool even
    # after setting WindowsSelectorEventLoopPolicy, because AsyncConnectionPool
    # spins background threads that acquire their own ProactorEventLoop.
    # Skip AsyncPostgresSaver on Windows and go straight to SyncPostgresSaver.
    if _sys.platform != "win32" and _AsyncPostgresSaver is not None and _AsyncConnectionPool is not None:
        logger.info(f"Initializing AsyncPostgresSaver with DB: {sync_db_url[:50]}...")
        try:
            pool = _AsyncConnectionPool(
                conninfo=sync_db_url,
                max_size=4,
                max_lifetime=300,
                kwargs={"autocommit": True, "prepare_threshold": 0},
                check=_AsyncConnectionPool.check_connection,
                open=False,
            )
            await pool.open()
            checkpointer = _AsyncPostgresSaver(pool)
            await checkpointer.setup()
            logger.info("AsyncPostgresSaver initialised and tables set up")
        except Exception as e:
            logger.warning(f"AsyncPostgresSaver init failed: {e}")

    # ── Option 2: sync postgres checkpointer ──────────────────────────────
    if checkpointer is None and _SyncPostgresSaver is not None:
        logger.info(f"Trying SyncPostgresSaver with DB: {sync_db_url[:50]}...")
        try:
            cp = _SyncPostgresSaver.from_conn_string(sync_db_url)
            cp.setup()
            checkpointer = cp
            logger.info("SyncPostgresSaver initialised and tables set up")
        except Exception as e:
            logger.warning(f"SyncPostgresSaver init failed: {e}")

    # ── Option 3: in-memory checkpointer (development fallback) ───────────
    if checkpointer is None:
        logger.warning(
            "No PostgresSaver available (langgraph-checkpoint-postgres not installed). "
            "Falling back to MemorySaver — checkpoint state will be LOST on process restart. "
            "Install langgraph-checkpoint-postgres and psycopg[binary] for persistence."
        )
        checkpointer = MemorySaver()

    graph = build_migration_graph(checkpointer)
    logger.info("Migration graph compiled and ready")
    return graph
