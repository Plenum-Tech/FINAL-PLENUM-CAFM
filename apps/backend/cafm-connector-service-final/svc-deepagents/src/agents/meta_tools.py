"""
Meta-capability tools for the DeepAgent orchestrator.

Implements the 4 built-in orchestration capabilities described in the system prompt:
  - write_todos   : explicit step-by-step planning before execution
  - task          : spawn a focused sub-agent scoped to one domain
  - write_file    : offload large datasets out of active context to temp storage
  - read_file     : retrieve previously written temp data
  - memory_set    : store a session-scoped key/value for recall later
  - memory_get    : retrieve a previously stored key/value

Call init_meta_tools(openai_api_key, model) once at startup (from orchestrator __init__).
Call set_session_context(session_id) before each orchestrator invocation so that temp
files and memory are namespaced per session.
"""
from __future__ import annotations

import json
import os
import tempfile
from contextvars import ContextVar
from typing import Any

import structlog
from ..llm_factory import create_chat_model
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

log = structlog.get_logger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Session context — set by orchestrator before each ainvoke call so that temp
# files and memory entries are automatically namespaced per session.
# ──────────────────────────────────────────────────────────────────────────────

_session_ctx: ContextVar[str] = ContextVar("cafm_session", default="shared")


def set_session_context(session_id: str) -> None:
    """Namespace all file and memory operations under session_id for this invocation."""
    _session_ctx.set(session_id)


def get_session_context() -> str:
    """Current orchestrator / workflow session id (ContextVar)."""
    return _session_ctx.get()


# ──────────────────────────────────────────────────────────────────────────────
# Module-level state — initialized once at startup via init_meta_tools()
# ──────────────────────────────────────────────────────────────────────────────

_task_runner: "_TaskRunner | None" = None
_TEMP_DIR: str = os.path.join(tempfile.gettempdir(), "cafm_deepagent")
_MEMORY: dict[str, dict[str, str]] = {}  # {session_id: {key: value}}

os.makedirs(_TEMP_DIR, exist_ok=True)


def init_meta_tools(openai_api_key: str, model: str = "gpt-4o-mini") -> None:
    """Initialize the task runner for subagent spawning. Called once from orchestrator.__init__."""
    global _task_runner
    _task_runner = _TaskRunner(openai_api_key, model)
    log.info("meta_tools.ready", model=model)


class _TaskRunner:
    """
    Runs focused sub-agents scoped to a single domain.
    Each domain agent is a separate LangGraph ReAct graph with only that domain's tools,
    keeping the subagent focused and preventing cross-domain tool use.

    Note: Sub-agents run without a checkpointer. Migration gate decisions are handled
    naturally through conversation — run_migration surfaces gates as return values and
    submit_* tools submit decisions, so no LangGraph interrupt() is needed.
    """

    def __init__(self, openai_api_key: str, model: str) -> None:
        # Deferred imports to avoid circular imports at module load time
        from .compliance_agent import check_requirements, generate_compliance_report
        from .doc_rag_agent import (
            delete_document,
            extract_text,
            get_document_metadata,
            index_document,
            query_docs,
            semantic_search,
        )
        from .migration_agent import (
            start_migration,
            run_migration,
            submit_pre_semantic,
            submit_field_mapping,
            submit_hierarchy,
            get_migration_status,
            get_migration_mappings,
            list_migrations,
        )
        from .fiix_agent import (
            configure_fiix_credentials,
            fetch_fiix_schema,
            get_fiix_ingestion_status,
            get_fiix_setup_status,
            get_schema_mapping_status,
            list_fiix_ingestion_jobs,
            start_fiix_ingestion,
            start_fiix_schema_mapping,
            test_fiix_connection,
        )
        from .schema_mapper_agent import continue_schema_mapping_gate
        from .udr_agent import lookup_user, query_table
        from .wo_engine_agent import (
            approve_work_order,
            close_work_order,
            confirm_intelligent_work_order_creation,
            prepare_intelligent_work_order,
            create_intelligent_work_order,
            create_work_order,
            customize_approval_chain,
            find_ppm_schedules,
            get_approval_chain,
            get_asset_details,
            get_dashboard_stats,
            get_work_order,
            get_work_order_history,
            get_work_order_status_track,
            list_work_orders,
            process_email_work_order,
            request_approval_chain,
            send_approval_request_email,
            respond_to_approval_step,
            search_assets,
            search_locations,
            suggest_approval_chain,
            transition_work_order,
            trigger_ppm_work_order,
            update_work_order,
        )

        llm = create_chat_model(api_key=openai_api_key, model=model)

        self._agents: dict[str, Any] = {
            "migration": create_react_agent(llm, tools=[
                start_migration, run_migration,
                submit_pre_semantic, submit_field_mapping, submit_hierarchy,
                get_migration_status, get_migration_mappings, list_migrations,
                get_fiix_setup_status, configure_fiix_credentials,
                test_fiix_connection, fetch_fiix_schema, start_fiix_schema_mapping,
                get_schema_mapping_status, continue_schema_mapping_gate,
                start_fiix_ingestion, get_fiix_ingestion_status, list_fiix_ingestion_jobs,
            ]),
            "doc_rag": create_react_agent(llm, tools=[
                index_document, query_docs, semantic_search,
                extract_text, get_document_metadata, delete_document,
            ]),
            "wo_engine": create_react_agent(llm, tools=[
                suggest_approval_chain, request_approval_chain, send_approval_request_email,
                get_approval_chain,
                customize_approval_chain, respond_to_approval_step,
                prepare_intelligent_work_order, confirm_intelligent_work_order_creation,
                create_intelligent_work_order,
                trigger_ppm_work_order, process_email_work_order,
                create_work_order, get_work_order, update_work_order, list_work_orders,
                transition_work_order, approve_work_order, close_work_order,
                get_work_order_history, get_work_order_status_track,
                search_assets, get_asset_details,
                search_locations, find_ppm_schedules, get_dashboard_stats,
            ]),
            "compliance": create_react_agent(llm, tools=[
                check_requirements, generate_compliance_report,
            ]),
            "udr": create_react_agent(llm, tools=[
                lookup_user, query_table,
            ]),
        }

    async def run(self, agent: str, prompt: str) -> str:
        runner = self._agents.get(agent)
        if runner is None:
            return json.dumps({
                "error": f"Unknown agent '{agent}'. Valid values: migration, doc_rag, wo_engine, compliance, udr"
            })
        try:
            result = await runner.ainvoke({"messages": [HumanMessage(content=prompt)]})
            messages = result.get("messages", [])
            for msg in reversed(messages):
                if (
                    hasattr(msg, "content")
                    and isinstance(msg.content, str)
                    and not getattr(msg, "tool_calls", None)
                ):
                    return msg.content
            return ""
        except Exception as exc:
            log.error("meta.task.error", agent=agent, error=str(exc))
            return json.dumps({"error": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# Meta-capability tools (registered with @tool — included in ALL_TOOLS)
# ──────────────────────────────────────────────────────────────────────────────

@tool
async def write_todos(todos: list[str]) -> str:
    """Write out a step-by-step execution plan before beginning a multi-step task.

    Use before any task with 3 or more steps, or any task touching more than one
    agent domain. Writing todos makes reasoning explicit and visible in the tool
    call trace. Do NOT use for simple, single-tool lookups (Mode 1).

    Args:
        todos: Ordered list of planned steps. Each step should name the agent or
               tool to use and what result is expected.

    Returns:
        Confirmation echoing all steps, confirming the plan was logged.
    """
    log.info("meta.write_todos", step_count=len(todos))
    numbered = "\n".join(f"{i + 1}. {step}" for i, step in enumerate(todos))
    return f"Plan recorded ({len(todos)} steps):\n{numbered}"


@tool
async def task(agent: str, prompt: str) -> str:
    """Spawn a domain subagent to handle a focused piece of work independently.

    The subagent runs its own ReAct loop using only the tools for the named domain.
    Use this to delegate domain-specific work and to enable parallel execution of
    independent workstreams (fire multiple task() calls in the same turn).

    Note: Sub-agents run without a LangGraph checkpointer. Migration HITL is handled
    conversationally — run_migration returns gate payloads for user review and submit_*
    tools submit decisions, requiring no separate stateful workflow.

    Args:
        agent:  Domain to spawn. One of: migration, doc_rag, wo_engine, compliance, udr
        prompt: Self-contained instruction for the subagent. Include all context
                it needs — it cannot see the parent thread history.

    Returns:
        The subagent's synthesised answer as a string.
    """
    if _task_runner is None:
        return json.dumps({
            "error": "Task runner not initialised. Call init_meta_tools() at startup."
        })
    log.info("meta.task", agent=agent, prompt_len=len(prompt))
    return await _task_runner.run(agent, prompt)


@tool
async def write_file(path: str, content: str) -> str:
    """Write content to temporary storage to offload large data from active context.

    Use when a tool returns 50+ records that need to be preserved for a later step
    but should not clutter the current context. Also use when assembling a report
    section by section. Files are namespaced per session automatically.

    Args:
        path:    Relative file path (e.g. 'report/assets.json', 'tmp/step1.txt').
                 Sub-directories are created automatically.
        content: String content to write — JSON, plain text, CSV, etc.

    Returns:
        Confirmation with the byte count and path, or an error dict on failure.
    """
    session = _session_ctx.get()
    full_path = os.path.join(_TEMP_DIR, session, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    try:
        with open(full_path, "w", encoding="utf-8") as fh:
            fh.write(content)
        log.info("meta.write_file", session=session, path=path, bytes=len(content))
        return f"Written {len(content)} bytes to '{path}'"
    except Exception as exc:
        log.error("meta.write_file.error", path=path, error=str(exc))
        return json.dumps({"error": str(exc)})


@tool
async def read_file(path: str) -> str:
    """Read a file previously written with write_file.

    Use to retrieve large datasets that were offloaded earlier in the workflow,
    or to read a customer-provided data file before passing it to start_migration.

    Args:
        path: Relative path used when write_file was called (e.g. 'report/assets.json').

    Returns:
        File contents as a string, or an error dict if the file is not found.
    """
    session = _session_ctx.get()
    full_path = os.path.join(_TEMP_DIR, session, path)
    try:
        with open(full_path, "r", encoding="utf-8") as fh:
            content = fh.read()
        log.info("meta.read_file", session=session, path=path, bytes=len(content))
        return content
    except FileNotFoundError:
        return json.dumps({"error": f"File not found: '{path}'. Use write_file first."})
    except Exception as exc:
        log.error("meta.read_file.error", path=path, error=str(exc))
        return json.dumps({"error": str(exc)})


@tool
async def memory_set(key: str, value: str) -> str:
    """Store a value in session memory for recall later in the conversation.

    Use to remember user preferences, active site, last queried assets, or the
    result of an expensive query so it does not need to be repeated.

    Args:
        key:   Descriptive memory key (e.g. 'active_site', 'last_asset', 'user_role').
               Use consistent, readable names.
        value: String value to store. Serialise complex objects as JSON strings.

    Returns:
        Confirmation that the value was stored under the given key.
    """
    session = _session_ctx.get()
    if session not in _MEMORY:
        _MEMORY[session] = {}
    _MEMORY[session][key] = value
    log.info("meta.memory_set", session=session, key=key)
    return f"Stored '{key}' in session memory."


@tool
async def memory_get(key: str) -> str:
    """Retrieve a value previously stored with memory_set.

    Use to recall session context — user preferences, previously looked-up data,
    or cached query results — without making a redundant tool call.

    Args:
        key: The key used when memory_set was called.

    Returns:
        The stored value as a string, or an error dict if the key is not found.
    """
    session = _session_ctx.get()
    value = _MEMORY.get(session, {}).get(key)
    if value is None:
        return json.dumps({"error": f"Key '{key}' not found in session memory. Use memory_set first."})
    log.info("meta.memory_get", session=session, key=key)
    return value
