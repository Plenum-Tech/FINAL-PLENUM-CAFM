"""
BE3 — DeepAgent orchestrator.
Wraps a LangGraph ReAct agent over all 54 CAFM tools with the CAFM system prompt.

Tool breakdown:
  Meta (6)        : write_todos, task, write_file, read_file, memory_set, memory_get
  UDR (13)        : get_schema, lookup_user, query_table, udr_agent_query,
                    udr_list_tables, udr_describe_table, udr_read_records, udr_get_record,
                    udr_search_records, udr_create_record, udr_update_record,
                    udr_delete_record, udr_execute_select
  WO Engine (22)  : 5 dynamic approval + 4 intelligent pipeline + 8 CRUD + 5 reference lookups
  Migration (8)   : start_migration, run_migration,
                    submit_pre_semantic, submit_field_mapping, submit_hierarchy,
                    get_migration_status, get_migration_mappings, list_migrations
  Fiix (10)       : get_fiix_setup_status, configure_fiix_credentials, test_fiix_connection,
                    fetch_fiix_schema, start_fiix_schema_mapping, get_schema_mapping_status,
                    continue_schema_mapping_gate, start_fiix_ingestion, get_fiix_ingestion_status,
                    list_fiix_ingestion_jobs
  Doc RAG (6)     : index_document, query_docs, semantic_search, extract_text,
                    get_document_metadata, delete_document
  Compliance (2)  : check_requirements, generate_compliance_report

Migration flow (mirrors frontend UI):
  run_migration() drives the pipeline automatically — auto-advances step_paused nodes,
  auto-confirms the write gate, and returns only when a user-decision gate fires.
  No LangGraph interrupt() gates in migration tools — the orchestrator handles HITL
  naturally through conversation (gate payload shown to user → user decides → submit_*).
"""
from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncGenerator
from typing import Any

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.errors import GraphInterrupt
from langgraph.prebuilt import create_react_agent
from langgraph.types import Command

from ..llm_factory import create_chat_model, friendly_openai_error
from .compliance_agent import check_requirements, generate_compliance_report
from .doc_rag_agent import (
    delete_document,
    extract_text,
    get_document_metadata,
    index_document,
    list_doc_rag_db_tables,
    list_row_index_tables,
    match_document_to_rows,
    query_docs,
    semantic_search,
)
from .meta_tools import (
    init_meta_tools,
    memory_get,
    memory_set,
    read_file,
    set_session_context,
    task,
    write_file,
    write_todos,
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
from .schema_mapper_agent import continue_schema_mapping_gate
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
from .fiix_credential_parse import (
    fiix_setup_status_snapshot,
    merge_fiix_credentials_from_message,
    message_looks_like_fiix_credentials,
)
from .ingest_batch_agent import get_ingest_batch_status, list_session_ingest_batches
from .connector_tools import list_available_source_connectors, test_source_connector_connection
from .udr_hybrid_tools import (
    retrieve_workspace_corpus_summary,
    retrieve_vector_evidence,
    resolve_cross_source_links,
)
from .session_workspace import (
    ROUTE_UDR_INGEST,
    ROUTE_UDR_MAP,
    ROUTE_WO_CLARIFY,
    ROUTE_WO_INTAKE,
    ROUTE_GENERAL,
    attach_route_to_result,
    workflow_stream_completion_payload,
    classify_route_intent,
    resolve_route_intent,
    default_session_state,
    get_session_state,
    mark_documents_ingested,
    record_batch_ingestion_complete,
    record_fiix_ingestion_started,
    ROUTE_FIIX_SYNC,
    build_session_runtime_context,
    record_conversation_turn,
    clear_pending_fiix_confirm,
    clear_pending_schema_gate_confirm,
    fiix_credentials_configured,
    resolve_active_schema_mapping_id,
    set_pending_fiix_confirm,
    set_pending_schema_gate_confirm,
    workspace_has_ingestion,
    workspace_snapshot,
    work_request_confidence_band,
    append_pending_batch,
)
from .system_prompt import build_system_prompt
from .udr_agent import (
    get_schema,
    lookup_user,
    query_table,
    udr_agent_query,
    udr_list_tables,
    udr_describe_table,
    udr_read_records,
    udr_get_record,
    udr_search_records,
    udr_create_record,
    udr_update_record,
    udr_delete_record,
    udr_execute_select,
)
from .wo_engine_agent import (
    # Dynamic approval (5)
    suggest_approval_chain,
    request_approval_chain,
    send_approval_request_email,
    get_approval_chain,
    customize_approval_chain,
    respond_to_approval_step,
    # Intelligent pipeline (4)
    prepare_intelligent_work_order,
    confirm_intelligent_work_order_creation,
    create_intelligent_work_order,
    trigger_ppm_work_order,
    process_email_work_order,
    # CRUD + lifecycle (8)
    create_work_order,
    get_work_order,
    update_work_order,
    list_work_orders,
    transition_work_order,
    approve_work_order,
    close_work_order,
    get_work_order_history,
    get_work_order_status_track,
    # Reference lookups (5)
    search_assets,
    get_asset_details,
    search_locations,
    find_ppm_schedules,
    get_dashboard_stats,
)

log = structlog.get_logger(__name__)

# Re-export for backward compatibility (tests, workers)
_SESSION_UDR_STATE = {}  # unused; state in session_workspace


def _default_session_state() -> dict[str, Any]:
    return default_session_state()


_AFFIRMATIVE_TOKENS = {
    "yes",
    "y",
    "ok",
    "okay",
    "sure",
    "proceed",
    "go ahead",
    "create it",
    "confirm",
    "continue",
    "yes continue",
}
_NEGATIVE_TOKENS = {
    "no",
    "n",
    "nope",
    "cancel",
    "stop",
    "not now",
    "don't",
    "dont",
}

ALL_TOOLS = [
    # Meta-capabilities (6)
    write_todos,
    task,
    write_file,
    read_file,
    memory_set,
    memory_get,
    # UDR (11+)
    get_schema,
    lookup_user,
    query_table,
    udr_agent_query,
    udr_list_tables,
    udr_describe_table,
    udr_read_records,
    udr_get_record,
    udr_search_records,
    udr_create_record,
    udr_update_record,
    udr_delete_record,
    udr_execute_select,
    # WO Engine — intelligent pipeline (4) — prepare before create
    prepare_intelligent_work_order,
    confirm_intelligent_work_order_creation,
    create_intelligent_work_order,
    trigger_ppm_work_order,
    process_email_work_order,
    # WO Engine — CRUD + lifecycle (8)
    create_work_order,
    # WO Engine — dynamic approval (5)
    suggest_approval_chain,
    request_approval_chain,
    send_approval_request_email,
    get_approval_chain,
    customize_approval_chain,
    respond_to_approval_step,
    get_work_order,
    update_work_order,
    list_work_orders,
    transition_work_order,
    approve_work_order,
    close_work_order,
    get_work_order_history,
    get_work_order_status_track,
    # WO Engine — reference lookups (5)
    search_assets,
    get_asset_details,
    search_locations,
    find_ppm_schedules,
    get_dashboard_stats,
    # Migration (8)
    start_migration,
    run_migration,
    submit_pre_semantic,
    submit_field_mapping,
    submit_hierarchy,
    get_migration_status,
    get_migration_mappings,
    list_migrations,
    # Fiix CMMS live schema + sync (10)
    get_fiix_setup_status,
    configure_fiix_credentials,
    test_fiix_connection,
    fetch_fiix_schema,
    start_fiix_schema_mapping,
    get_schema_mapping_status,
    continue_schema_mapping_gate,
    start_fiix_ingestion,
    get_fiix_ingestion_status,
    list_fiix_ingestion_jobs,
    # Bulk ingest (2)
    get_ingest_batch_status,
    list_session_ingest_batches,
    # Hybrid UDR (3)
    retrieve_workspace_corpus_summary,
    retrieve_vector_evidence,
    resolve_cross_source_links,
    # Source connectors (2)
    list_available_source_connectors,
    test_source_connector_connection,
    # Doc RAG (10)
    index_document,
    query_docs,
    semantic_search,
    extract_text,
    get_document_metadata,
    delete_document,
    list_row_index_tables,
    list_doc_rag_db_tables,
    match_document_to_rows,
    # Compliance (2)
    check_requirements,
    generate_compliance_report,
]

# Maps every tool name to its agent domain — used for agent_switch streaming events.
_TOOL_DOMAIN: dict[str, str] = {
    # Meta (6)
    "write_todos": "meta", "task": "meta", "write_file": "meta",
    "read_file": "meta", "memory_set": "meta", "memory_get": "meta",
    # UDR (11+)
    "get_schema": "udr", "lookup_user": "udr", "query_table": "udr",
    "udr_agent_query": "udr",
    "udr_list_tables": "udr",
    "udr_describe_table": "udr",
    "udr_read_records": "udr",
    "udr_get_record": "udr",
    "udr_search_records": "udr",
    "udr_create_record": "udr",
    "udr_update_record": "udr",
    "udr_delete_record": "udr",
    "udr_execute_select": "udr",
    # WO Engine — dynamic approval (6)
    "suggest_approval_chain": "wo_engine",
    "request_approval_chain": "wo_engine",
    "send_approval_request_email": "wo_engine",
    "get_approval_chain": "wo_engine",
    "customize_approval_chain": "wo_engine",
    "respond_to_approval_step": "wo_engine",
    # WO Engine — intelligent pipeline (3)
    "prepare_intelligent_work_order": "wo_engine",
    "confirm_intelligent_work_order_creation": "wo_engine",
    "create_intelligent_work_order": "wo_engine",
    "trigger_ppm_work_order": "wo_engine",
    "process_email_work_order": "wo_engine",
    # WO Engine — CRUD + lifecycle (8)
    "create_work_order": "wo_engine", "get_work_order": "wo_engine",
    "update_work_order": "wo_engine", "list_work_orders": "wo_engine",
    "transition_work_order": "wo_engine", "approve_work_order": "wo_engine",
    "close_work_order": "wo_engine", "get_work_order_history": "wo_engine",
    "get_work_order_status_track": "wo_engine",
    # WO Engine — reference lookups (5)
    "search_assets": "wo_engine", "get_asset_details": "wo_engine",
    "search_locations": "wo_engine", "find_ppm_schedules": "wo_engine",
    "get_dashboard_stats": "wo_engine",
    # Migration (8)
    "start_migration": "migration", "run_migration": "migration",
    "submit_pre_semantic": "migration", "submit_field_mapping": "migration",
    "submit_hierarchy": "migration", "get_migration_status": "migration",
    "get_migration_mappings": "migration", "list_migrations": "migration",
    # Fiix (9)
    "get_fiix_setup_status": "fiix",
    "configure_fiix_credentials": "fiix",
    "test_fiix_connection": "fiix",
    "fetch_fiix_schema": "fiix",
    "start_fiix_schema_mapping": "fiix",
    "get_schema_mapping_status": "fiix",
    "continue_schema_mapping_gate": "fiix",
    "start_fiix_ingestion": "fiix",
    "get_fiix_ingestion_status": "fiix",
    "list_fiix_ingestion_jobs": "fiix",
    # Bulk ingest (2)
    "get_ingest_batch_status": "ingest_batch",
    "list_session_ingest_batches": "ingest_batch",
    "retrieve_workspace_corpus_summary": "udr",
    "retrieve_vector_evidence": "udr",
    "resolve_cross_source_links": "udr",
    "list_available_source_connectors": "connector",
    "test_source_connector_connection": "connector",
    # Doc RAG (10)
    "index_document": "doc_rag", "query_docs": "doc_rag",
    "semantic_search": "doc_rag", "extract_text": "doc_rag",
    "get_document_metadata": "doc_rag", "delete_document": "doc_rag",
    "list_row_index_tables": "doc_rag", "list_doc_rag_db_tables": "doc_rag",
    "match_document_to_rows": "doc_rag",
    # Compliance (2)
    "check_requirements": "compliance", "generate_compliance_report": "compliance",
}


def _extract_interrupt(result: dict[str, Any]) -> dict | None:
    """Return the first interrupt payload if the graph paused, else None."""
    interrupts = result.get("__interrupt__", ())
    if interrupts:
        iv = interrupts[0]
        return iv.value if hasattr(iv, "value") else iv
    return None


def _extract_tool_calls(messages: list) -> list[dict[str, Any]]:
    """Extract the tool call trace from LangGraph message history."""
    tool_calls: list[dict[str, Any]] = []
    for msg in messages:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                tool_calls.append({
                    "tool": tc.get("name"),
                    "input": tc.get("args", {}),
                })
        if hasattr(msg, "name") and msg.name and hasattr(msg, "content"):
            if tool_calls and "output" not in tool_calls[-1]:
                tool_calls[-1]["output"] = msg.content
    return tool_calls


def _extract_answer(messages: list) -> str:
    for msg in reversed(messages):
        if (
            hasattr(msg, "content")
            and isinstance(msg.content, str)
            and not getattr(msg, "tool_calls", None)
        ):
            return msg.content
    return ""


class DeepAgentOrchestrator:
    """
    Main orchestrator for the Plenum CAFM platform.

    Wraps a LangGraph ReAct agent (gpt-4o-mini) with all 46 CAFM tools.

    When a checkpointer is provided (HITL mode):
      - run() and run_stateful() detect interrupt() calls and surface them
        as interrupted=True in the response.
      - resume() continues an interrupted workflow with a human decision.

    Without a checkpointer the agent runs statelessly and HITL gates are
    skipped automatically (settings.hitl_enabled controls this).
    """

    def __init__(
        self,
        openai_api_key: str,
        model: str = "gpt-4o-mini",
        checkpointer: Any = None,
    ) -> None:
        self._model_id = model
        self._has_hitl = checkpointer is not None
        self._llm = create_chat_model(api_key=openai_api_key, model=model)
        self._agent = create_react_agent(
            model=self._llm,
            tools=ALL_TOOLS,
            checkpointer=checkpointer,
        )
        init_meta_tools(openai_api_key=openai_api_key, model=model)
        log.info(
            "orchestrator.ready",
            model=model,
            tool_count=len(ALL_TOOLS),
            hitl=self._has_hitl,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _config(self, thread_id: str) -> dict:
        """Build the LangGraph run config for a given thread."""
        return {"configurable": {"thread_id": thread_id}}

    @staticmethod
    def _wrap_stateful_user_message(
        session_id: str,
        user_message: str,
        extra_context: str | None,
    ) -> str:
        """Prefix workspace + recent chat so every turn retains solution context."""
        runtime = build_session_runtime_context(session_id)
        parts: list[str] = []
        if extra_context and extra_context.strip():
            parts.append(extra_context.strip())
        if runtime:
            parts.append(runtime)
        if not parts:
            return user_message
        return "\n\n".join(parts) + f"\n\n---\n\n**Current user message:**\n{user_message}"

    async def _thread_has_prior_messages(self, thread_id: str) -> bool:
        if not self._has_hitl:
            return False
        try:
            snap = await self._agent.aget_state(self._config(thread_id))
            if snap is None:
                return False
            msgs = (snap.values or {}).get("messages") or []
            return len(msgs) > 0
        except Exception:
            return False

    async def _build_stateful_input(
        self,
        session_id: str,
        user_message: str,
        extra_context: str | None,
    ) -> dict[str, Any]:
        wrapped = self._wrap_stateful_user_message(session_id, user_message, extra_context)
        system_prompt = build_system_prompt(extra_context)
        if await self._thread_has_prior_messages(session_id):
            return {"messages": [HumanMessage(content=wrapped)]}
        return {
            "messages": [
                SystemMessage(content=system_prompt),
                HumanMessage(content=wrapped),
            ],
        }

    async def _maybe_apply_fiix_credentials_from_message(
        self,
        session_id: str,
        user_message: str,
        session_state: dict[str, Any],
        route_intent: str,
    ) -> dict[str, Any] | None:
        """Parse pasted credentials and auto-advance test → fetch → mapping."""
        if not message_looks_like_fiix_credentials(user_message) and route_intent != ROUTE_FIIX_SYNC:
            if not session_state.get("pending_fiix_confirm"):
                return None
        was_configured = fiix_credentials_configured(session_id)
        merge_fiix_credentials_from_message(session_id, user_message)
        if not fiix_credentials_configured(session_id):
            if message_looks_like_fiix_credentials(user_message):
                setup = fiix_setup_status_snapshot(session_id)
                return attach_route_to_result(
                    {
                        "session_id": session_id,
                        "answer": self._fiix_credential_prompt_text(setup),
                        "tool_calls": [],
                        "success": True,
                        "error": None,
                        "interrupted": False,
                        "interrupt_payload": None,
                    },
                    session_id,
                    intent=ROUTE_FIIX_SYNC,
                    domain="fiix",
                    next_step_prompt="Provide any missing Fiix fields in one message.",
                )
            return None
        if (
            not was_configured
            or route_intent == ROUTE_FIIX_SYNC
            or session_state.get("pending_fiix_confirm")
            or message_looks_like_fiix_credentials(user_message)
        ):
            action = str(session_state.get("pending_fiix_action") or "schema_mapping")
            if "ingest" in user_message.lower() or "sync" in user_message.lower():
                action = "ingestion"
            log.info("orchestrator.fiix_credentials_applied", session_id=session_id)
            return await self._fiix_continue_after_credentials(session_id, action=action)
        return None

    async def _stateful_preflight_shortcut(
        self,
        user_message: str,
        session_id: str,
        session_state: dict[str, Any],
        route_intent: str,
        msg_l: str,
    ) -> dict[str, Any] | None:
        """Deterministic short paths shared by REST and WebSocket."""
        creds_out = await self._maybe_apply_fiix_credentials_from_message(
            session_id, user_message, session_state, route_intent
        )
        if creds_out is not None:
            return creds_out

        if route_intent == ROUTE_FIIX_SYNC and self._is_affirmative_message(msg_l):
            set_pending_fiix_confirm(
                session_id,
                action=(
                    "ingestion"
                    if any(t in msg_l for t in ("ingest", "sync", "pull data"))
                    else "schema_mapping"
                ),
            )

        fiix_proactive = await self._maybe_fiix_proactive_setup(
            session_id, session_state, route_intent
        )
        if fiix_proactive is not None and not self._is_affirmative_message(msg_l):
            return fiix_proactive

        shortcut = await self._maybe_schema_gate_short_reply(
            user_message, session_id, session_state
        )
        if shortcut is None:
            shortcut = await self._maybe_fiix_short_reply(
                user_message, session_id, session_state
            )
        if shortcut is None:
            shortcut = await self._maybe_status_query_shortcut(user_message, session_id)
        if shortcut is None:
            shortcut = await self._maybe_short_reply_wo_action(user_message, session_id)
        return shortcut

    def mark_single_door_ingestion(
        self,
        session_id: str,
        ingested_count: int,
        flow_summary: str,
    ) -> None:
        mark_documents_ingested(session_id, ingested_count, flow_summary)

    def mark_fiix_ingestion(self, session_id: str, ingestion_id: str) -> None:
        record_fiix_ingestion_started(session_id, ingestion_id)

    def register_active_batch(self, session_id: str, batch_id: str, file_count: int) -> None:
        append_pending_batch(session_id, batch_id)
        get_session_state(session_id)["last_flow_summary"] = (
            f"Bulk ingest batch {batch_id} queued ({file_count} files)."
        )

    @staticmethod
    async def get_workspace_status(session_id: str) -> dict[str, Any]:
        from .session_workspace import refresh_workspace_from_migrations

        await refresh_workspace_from_migrations(session_id)
        return workspace_snapshot(session_id)

    @staticmethod
    def _is_affirmative_message(user_message: str) -> bool:
        msg = " ".join((user_message or "").strip().lower().split())
        if not msg:
            return False
        if msg in _AFFIRMATIVE_TOKENS:
            return True
        return msg.startswith("yes")

    @staticmethod
    def _is_negative_message(user_message: str) -> bool:
        msg = " ".join((user_message or "").strip().lower().split())
        if not msg:
            return False
        return msg in _NEGATIVE_TOKENS or msg.startswith("no")

    @staticmethod
    def _approval_intent(msg: str) -> bool:
        return (
            "approval chain" in msg
            or " request approval" in msg
            or " confirm approval" in msg
            or " proceed with approval" in msg
            or " continue with approval" in msg
            or " continue with this approval" in msg
            or " confirming to continue" in msg
            or "confirming to continue" in msg
            or " send email" in msg
            or "send email" in msg
            or " email for approval" in msg
            or "notify approver" in msg
            or ("approve" in msg and "work order" in msg)
            or ("approval" in msg and "confirm" in msg)
        )

    @staticmethod
    def _is_approval_followup_message(msg: str) -> bool:
        """Longer approval/email confirmations that do not start with 'yes'."""
        return DeepAgentOrchestrator._approval_intent(msg) and (
            "confirm" in msg
            or "continue" in msg
            or "send" in msg
            or "email" in msg
            or "notify" in msg
        )

    async def _approval_shortcut_response(
        self,
        session_id: str,
        wo_id: str,
        user_message: str = "",
    ) -> dict[str, Any]:
        msg = " ".join((user_message or "").strip().lower().split())
        want_explicit_email = "email" in msg or "send" in msg or "notify" in msg

        out = await request_approval_chain.ainvoke(
            {"work_order_id": wo_id, "session_id": session_id}
        )
        tool_calls: list[dict[str, Any]] = [
            {
                "tool": "request_approval_chain",
                "input": {"work_order_id": wo_id, "session_id": session_id},
                "output": json.dumps(out, default=str),
            }
        ]

        if isinstance(out, dict) and (out.get("error") or out.get("success") is False):
            answer = out.get("message") or out.get("error") or "Approval request failed."
            return {
                "session_id": session_id,
                "answer": answer,
                "tool_calls": tool_calls,
                "success": False,
                "error": answer,
                "interrupted": False,
                "interrupt_payload": None,
            }

        wo_id_out = out.get("work_order_id") or wo_id
        email_sent = bool(out.get("email_sent"))
        email_out: dict[str, Any] | None = None

        if want_explicit_email or not email_sent or out.get("already_exists"):
            email_out = await send_approval_request_email.ainvoke(
                {"work_order_id": wo_id_out, "session_id": session_id, "step_order": 1}
            )
            tool_calls.append(
                {
                    "tool": "send_approval_request_email",
                    "input": {"work_order_id": wo_id_out, "session_id": session_id},
                    "output": json.dumps(email_out, default=str),
                }
            )
            if isinstance(email_out, dict) and email_out.get("email_sent"):
                email_sent = True

        if email_sent:
            approver_name = (
                (email_out or {}).get("approver_name")
                or out.get("approver_name")
            )
            approver_email = (
                (email_out or {}).get("approver")
                or (email_out or {}).get("approver_email")
                or out.get("approver")
            )
            if approver_name and approver_email:
                recipient = f"{approver_name} ({approver_email})"
            else:
                recipient = approver_name or approver_email or "the step 1 approver"
            answer = (
                f"Approval chain is active for {wo_id_out}. "
                f"Approval request email sent to {recipient} via Outlook."
            )
        elif out.get("already_exists"):
            answer = out.get("message") or f"Approval chain is already active for {wo_id_out}."
        else:
            answer = (
                out.get("message")
                or f"Approval chain saved for {wo_id_out}. "
                "Outlook is not configured — set OUTLOOK_USER_EMAIL and Azure Graph credentials."
            )

        return {
            "session_id": session_id,
            "answer": answer,
            "tool_calls": tool_calls,
            "success": True,
            "error": None,
            "interrupted": False,
            "interrupt_payload": None,
        }

    @staticmethod
    def _is_wo_status_query(msg: str) -> bool:
        if not msg:
            return False
        from .wo_engine_agent import extract_work_order_id_from_text

        has_wo = (
            "work order" in msg
            or "wo-" in msg
            or bool(extract_work_order_id_from_text(msg))
        )
        if not has_wo:
            return False
        status_phrases = (
            "status",
            "progress",
            "track",
            "where is",
            "where's",
            "approval status",
            "who approved",
            "technician",
            "assigned to",
            "work order details",
            "wo details",
            "lifecycle",
            "on hold",
            "in progress",
            "pending approval",
            "completed",
            "timeline",
        )
        return any(p in msg for p in status_phrases)

    async def _maybe_status_query_shortcut(
        self,
        user_message: str,
        session_id: str,
    ) -> dict[str, Any] | None:
        from .wo_engine_agent import (
            _LAST_WORK_ORDER_ID as _GLOBAL_WO_ID,
            _SESSION_WORK_ORDER_MAP,
            extract_work_order_id_from_text,
            format_work_order_status_track,
            get_work_order_status_track,
        )

        msg = " ".join((user_message or "").strip().lower().split())
        if not self._is_wo_status_query(msg):
            return None

        wo_id = (
            extract_work_order_id_from_text(user_message)
            or _SESSION_WORK_ORDER_MAP.get(session_id)
            or _GLOBAL_WO_ID
        )
        if not wo_id:
            return None

        out = await get_work_order_status_track.ainvoke({"work_order_id": wo_id})
        tool_calls = [
            {
                "tool": "get_work_order_status_track",
                "input": {"work_order_id": wo_id},
                "output": json.dumps(out, default=str),
            }
        ]
        if isinstance(out, dict) and out.get("error"):
            answer = out.get("error") or "Could not load work order status."
            return {
                "session_id": session_id,
                "answer": answer,
                "tool_calls": tool_calls,
                "success": False,
                "error": answer,
                "interrupted": False,
                "interrupt_payload": None,
            }

        answer = (
            (out.get("formatted_summary") if isinstance(out, dict) else None)
            or format_work_order_status_track(out if isinstance(out, dict) else {})
            or out.get("summary_message")
            or "Status loaded."
        )
        return {
            "session_id": session_id,
            "answer": answer,
            "tool_calls": tool_calls,
            "success": True,
            "error": None,
            "interrupted": False,
            "interrupt_payload": None,
        }

    async def _maybe_short_reply_wo_action(
        self,
        user_message: str,
        session_id: str,
    ) -> dict[str, Any] | None:
        """
        Fast-path short confirmations in same session without forcing LLM reasoning.

        - "yes"/"proceed" before WO exists -> confirm_intelligent_work_order_creation
        - "yes" after WO exists (or approval phrases) -> request_approval_chain
        """
        from .wo_engine_agent import (
            _LAST_WORK_ORDER_ID as _GLOBAL_WO_ID,
            _PENDING_APPROVAL_CONFIRM as _GLOBAL_PENDING_APPROVAL,
            _SESSION_CREATE_ARGS_MAP,
            _SESSION_WORK_ORDER_MAP,
        )

        from .wo_engine_agent import extract_work_order_id_from_text

        msg = " ".join((user_message or "").strip().lower().split())
        approval_followup = self._is_approval_followup_message(msg)
        if not self._is_affirmative_message(msg) and not approval_followup:
            return None

        wo_id = (
            _SESSION_WORK_ORDER_MAP.get(session_id)
            or _GLOBAL_WO_ID
            or extract_work_order_id_from_text(user_message)
        )
        has_draft = session_id in _SESSION_CREATE_ARGS_MAP
        awaiting_approval = _GLOBAL_PENDING_APPROVAL == session_id

        if has_draft:
            out = await confirm_intelligent_work_order_creation.ainvoke({"session_id": session_id})
            if isinstance(out, dict) and not out.get("error"):
                answer = out.get("reply") or out.get("message") or "Work order created successfully."
                return {
                    "session_id": session_id,
                    "answer": answer,
                    "tool_calls": [
                        {
                            "tool": "confirm_intelligent_work_order_creation",
                            "input": {"session_id": session_id},
                            "output": json.dumps(out, default=str),
                        }
                    ],
                    "success": True,
                    "error": None,
                    "interrupted": False,
                    "interrupt_payload": None,
                }
            return None

        if wo_id and (
            awaiting_approval
            or self._approval_intent(msg)
            or approval_followup
        ):
            return await self._approval_shortcut_response(session_id, wo_id, user_message)

        if wo_id and self._is_affirmative_message(msg):
            return await self._approval_shortcut_response(session_id, wo_id, user_message)

        return None

    @staticmethod
    def _fiix_credential_prompt_text(setup: dict) -> str:
        missing = setup.get("missing_fields") or []
        if missing:
            # Show ONLY what's still missing (already-provided fields are accepted),
            # so the user isn't asked again for keys they just entered.
            lines = "\n".join(f"  • {m}" for m in missing)
            plural = "s" if len(missing) != 1 else ""
            return (
                f"Fiix connection — still need the following field{plural} "
                f"(other credentials accepted):\n{lines}\n\n"
                "Paste as `Field: value` — e.g. `Subdomain: plenumtechnology`."
            )
        return setup.get("required_prompt") or (
            "Please provide your Fiix credentials (Subdomain, App Key, Access Key, Secret Key)."
        )

    async def _fiix_continue_after_credentials(
        self, session_id: str, *, action: str
    ) -> dict[str, Any]:
        """Run test → fetch → schema mapping or ingestion after credentials are stored."""
        tool_calls: list[dict[str, Any]] = []

        test_out = await test_fiix_connection.ainvoke({})
        tool_calls.append(
            {"tool": "test_fiix_connection", "input": {}, "output": json.dumps(test_out, default=str)}
        )
        if isinstance(test_out, dict) and test_out.get("error"):
            clear_pending_fiix_confirm(session_id)
            return {
                "session_id": session_id,
                "answer": f"Fiix connection test failed: {test_out.get('error')}",
                "tool_calls": tool_calls,
                "success": False,
                "error": str(test_out.get("error")),
                "interrupted": False,
                "interrupt_payload": None,
            }

        fetch_out = await fetch_fiix_schema.ainvoke({})
        tool_calls.append(
            {"tool": "fetch_fiix_schema", "input": {}, "output": json.dumps(fetch_out, default=str)}
        )
        if isinstance(fetch_out, dict) and fetch_out.get("error"):
            clear_pending_fiix_confirm(session_id)
            return {
                "session_id": session_id,
                "answer": f"Live Fiix schema fetch failed: {fetch_out.get('error')}",
                "tool_calls": tool_calls,
                "success": False,
                "error": str(fetch_out.get("error")),
                "interrupted": False,
                "interrupt_payload": None,
            }

        summary = (fetch_out or {}).get("summary") or {}
        comparison = (fetch_out or {}).get("schema_comparison") or {}
        display = (fetch_out or {}).get("display_summary") or comparison.get("markdown") or ""
        table_count = int(summary.get("table_count") or 0)
        sample = summary.get("sample_tables") or []
        lines: list[str] = []
        if display:
            lines.append(display.strip())
        else:
            lines.append("Fiix connection is working.")
            lines.append(f"Live schema: **{table_count}** Fiix object(s) detected.")
            if sample:
                lines.append("Sample objects: " + ", ".join(str(t) for t in sample[:10]))
        if table_count == 0:
            clear_pending_fiix_confirm(session_id)
            lines.append(
                "No tables were returned — check credentials and Fiix tenant permissions before mapping."
            )
            return attach_route_to_result(
                {
                    "session_id": session_id,
                    "answer": "\n".join(lines),
                    "tool_calls": tool_calls,
                    "success": True,
                    "error": None,
                    "interrupted": False,
                    "interrupt_payload": None,
                },
                session_id,
                intent=ROUTE_FIIX_SYNC,
                domain="fiix",
            )

        if action == "ingestion":
            map_out = await start_fiix_ingestion.ainvoke({})
            tool_calls.append(
                {
                    "tool": "start_fiix_ingestion",
                    "input": {},
                    "output": json.dumps(map_out, default=str),
                }
            )
            clear_pending_fiix_confirm(session_id)
            ing_id = (map_out or {}).get("ingestion_id") or ""
            if ing_id:
                record_fiix_ingestion_started(session_id, str(ing_id))
            lines.append(
                f"Started Fiix data sync (ingestion_id={ing_id}). "
                "Ask for status anytime to poll progress."
                if ing_id
                else f"Could not start ingestion: {(map_out or {}).get('error', map_out)}"
            )
        else:
            map_out = await start_fiix_schema_mapping.ainvoke({})
            tool_calls.append(
                {
                    "tool": "start_fiix_schema_mapping",
                    "input": {},
                    "output": json.dumps(map_out, default=str),
                }
            )
            schema_id = (map_out or {}).get("schema_mapping_id") or ""
            if schema_id:
                set_pending_schema_gate_confirm(session_id, schema_mapping_id=str(schema_id))
                clear_pending_fiix_confirm(session_id)
                intro = str(get_session_state(session_id).get("last_fiix_display_summary") or "").strip()
                lines = [intro] if intro else []
                lines.append(
                    f"Schema mapping started (`{schema_id}`).\n\n"
                    "Reply **yes** to load the current gate here in chat, "
                    "or open the **Schema Mapping** UI to review gates visually."
                )
            else:
                clear_pending_fiix_confirm(session_id)
                lines.append(f"Could not start schema mapping: {(map_out or {}).get('error', map_out)}")

        return attach_route_to_result(
            {
                "session_id": session_id,
                "answer": "\n".join(lines),
                "tool_calls": tool_calls,
                "success": True,
                "error": None,
                "interrupted": False,
                "interrupt_payload": None,
            },
            session_id,
            intent=ROUTE_FIIX_SYNC,
            domain="fiix",
        )

    @staticmethod
    def _format_schema_mapping_status_answer(status: dict[str, Any], schema_id: str) -> str:
        st = str(status.get("status") or "").lower()
        gate = str(status.get("pending_gate_type") or "").replace("_", " ")
        progress = status.get("progress_pct")
        comparison = status.get("schema_comparison") or {}
        display = status.get("display_summary") or (
            comparison.get("markdown") if isinstance(comparison, dict) else ""
        )
        lines: list[str] = []
        if display:
            lines.append(str(display).strip())
        lines.append(f"**Schema mapping** `{schema_id}` — status: **{st or 'unknown'}**")
        if progress is not None:
            lines.append(f"Progress: {progress}%")
        if st in ("complete", "failed", "error", "ddl_failed"):
            if st == "complete":
                lines.append("All gates are complete. You can start Fiix data ingestion when ready.")
            else:
                err = status.get("error_message") or status.get("ddl_error") or ""
                if err:
                    lines.append(f"Error: {err}")
            return "\n\n".join(lines)
        if st == "awaiting_review" and gate:
            lines.append(
                f"**Current gate:** {gate} — review mappings in the Schema Mapping UI "
                f"(session `{schema_id}`), or tell me what to approve and I will guide next steps."
            )
        elif st in ("running", "step_paused", "mapping"):
            lines.append(
                "The pipeline is still running. I can poll again in a moment, "
                "or you can watch progress in the Schema Mapping UI."
            )
        else:
            lines.append(
                "Say **status** anytime and I will poll again. "
                "Use the Schema Mapping UI for full gate forms."
            )
        return "\n\n".join(lines)

    def _schema_gate_followup(self, msg: str, session_state: dict[str, Any]) -> bool:
        if session_state.get("pending_schema_gate_confirm"):
            return True
        active = str(session_state.get("active_schema_mapping_id") or "").strip()
        ids = session_state.get("schema_mapping_ids") or []
        if not (active or ids):
            return False
        if self._is_affirmative_message(msg):
            return True
        return self._is_schema_gate_intent(msg)

    @staticmethod
    def _is_schema_gate_intent(msg: str) -> bool:
        return any(
            t in msg
            for t in (
                "gate",
                "schema mapping",
                "field mapping",
                "hierarchy",
                "pre-semantic",
                "pre semantic",
                "artifacts",
                "mapping status",
                "schema status",
            )
        )

    async def _maybe_schema_gate_short_reply(
        self,
        user_message: str,
        session_id: str,
        session_state: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Handle yes / proceed after Fiix schema mapping gate offer."""
        msg = " ".join((user_message or "").strip().lower().split())
        state_with_sid = {**session_state, "session_id": session_id}
        if not self._schema_gate_followup(msg, state_with_sid):
            return None
        if not (self._is_affirmative_message(msg) or self._is_schema_gate_intent(msg)):
            return None

        schema_id = resolve_active_schema_mapping_id(session_id)
        if not schema_id:
            return None

        status_out = await get_schema_mapping_status.ainvoke(
            {"schema_mapping_id": schema_id}
        )
        tool_calls = [
            {
                "tool": "get_schema_mapping_status",
                "input": {"schema_mapping_id": schema_id},
                "output": json.dumps(status_out, default=str),
            }
        ]
        if isinstance(status_out, dict) and status_out.get("error"):
            return attach_route_to_result(
                {
                    "session_id": session_id,
                    "answer": f"Could not load schema mapping status: {status_out.get('error')}",
                    "tool_calls": tool_calls,
                    "success": False,
                    "error": str(status_out.get("error")),
                    "interrupted": False,
                    "interrupt_payload": None,
                },
                session_id,
                intent=ROUTE_FIIX_SYNC,
                domain="fiix",
            )

        st = str((status_out or {}).get("status") or "").lower()
        if self._is_affirmative_message(msg) and (
            st in ("awaiting_review", "step_paused")
            or session_state.get("pending_schema_gate_confirm")
        ):
            gate_out = await continue_schema_mapping_gate.ainvoke(
                {"schema_mapping_id": schema_id}
            )
            tool_calls.append(
                {
                    "tool": "continue_schema_mapping_gate",
                    "input": {"schema_mapping_id": schema_id},
                    "output": json.dumps(gate_out, default=str),
                }
            )
            if isinstance(gate_out, dict) and not gate_out.get("error"):
                answer = str(gate_out.get("message") or "")
                display = gate_out.get("display_summary") or ""
                if display and display not in answer:
                    answer = f"{display.strip()}\n\n{answer}".strip()
                answer += (
                    "\n\nUse the **Schema** tab in the right rail for the full gate UI "
                    "(same as standalone Schema Mapper)."
                )
                follow = gate_out.get("status")
                if isinstance(follow, dict) and str(follow.get("status") or "").lower() == "complete":
                    clear_pending_schema_gate_confirm(session_id)
                return attach_route_to_result(
                    {
                        "session_id": session_id,
                        "answer": answer,
                        "tool_calls": tool_calls,
                        "success": True,
                        "error": None,
                        "interrupted": False,
                        "interrupt_payload": None,
                    },
                    session_id,
                    intent=ROUTE_FIIX_SYNC,
                    domain="fiix",
                )

        if st == "complete":
            clear_pending_schema_gate_confirm(session_id)

        answer = self._format_schema_mapping_status_answer(
            status_out if isinstance(status_out, dict) else {},
            schema_id,
        )
        answer += (
            "\n\nOpen the **Schema** tab in the right rail to use the same gate forms as "
            "Schema Mapper, or reply **yes** to submit the current gate with approve-all defaults."
        )
        return attach_route_to_result(
            {
                "session_id": session_id,
                "answer": answer,
                "tool_calls": tool_calls,
                "success": True,
                "error": None,
                "interrupted": False,
                "interrupt_payload": None,
            },
            session_id,
            intent=ROUTE_FIIX_SYNC,
            domain="fiix",
            next_step_prompt="Reply yes to submit current gate, or use Schema rail panel.",
        )

    async def _maybe_fiix_short_reply(
        self,
        user_message: str,
        session_id: str,
        session_state: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Handle 'yes' / proceed for Fiix schema sync without ambiguous LLM replies."""
        msg = " ".join((user_message or "").strip().lower().split())

        if resolve_active_schema_mapping_id(session_id) and self._is_affirmative_message(msg):
            return None

        fiix_context = (
            session_state.get("last_route_intent") == ROUTE_FIIX_SYNC
            or bool(session_state.get("pending_fiix_confirm"))
            or "fiix" in msg
        )
        if not fiix_context:
            return None
        if not self._is_affirmative_message(msg):
            return None

        set_pending_fiix_confirm(
            session_id,
            action=str(session_state.get("pending_fiix_action") or "schema_mapping"),
        )
        state = get_session_state(session_id)
        action = str(state.get("pending_fiix_action") or "schema_mapping")

        if not fiix_credentials_configured(session_id):
            setup = fiix_setup_status_snapshot(session_id)
            return attach_route_to_result(
                {
                    "session_id": session_id,
                    "answer": self._fiix_credential_prompt_text(setup),
                    "tool_calls": [
                        {
                            "tool": "get_fiix_setup_status",
                            "input": {},
                            "output": json.dumps(setup, default=str),
                        }
                    ],
                    "success": True,
                    "error": None,
                    "interrupted": False,
                    "interrupt_payload": None,
                },
                session_id,
                intent=ROUTE_FIIX_SYNC,
                domain="fiix",
                next_step_prompt="Provide all four Fiix credential fields, then I will test and fetch live schema.",
            )

        return await self._fiix_continue_after_credentials(session_id, action=action)

    async def _maybe_fiix_proactive_setup(
        self,
        session_id: str,
        session_state: dict[str, Any],
        route_intent: str,
    ) -> dict[str, Any] | None:
        """On Fiix intent, ask for credentials first (Schema Mapper UI parity)."""
        if route_intent != ROUTE_FIIX_SYNC:
            return None
        if fiix_credentials_configured(session_id):
            return None
        setup = fiix_setup_status_snapshot(session_id)
        if setup.get("configured"):
            return None
        return attach_route_to_result(
            {
                "session_id": session_id,
                "answer": self._fiix_credential_prompt_text(setup),
                "tool_calls": [
                    {
                        "tool": "get_fiix_setup_status",
                        "input": {},
                        "output": json.dumps(setup, default=str),
                    }
                ],
                "success": True,
                "error": None,
                "interrupted": False,
                "interrupt_payload": None,
            },
            session_id,
            intent=ROUTE_FIIX_SYNC,
            domain="fiix",
            next_step_prompt="Reply with subdomain, App Key, Access Key, and Secret Key.",
        )

    @staticmethod
    def _extract_priority_from_text(msg_l: str) -> str:
        if any(k in msg_l for k in ("critical", "asap", "immediately", "emergency")):
            return "critical"
        if any(k in msg_l for k in ("urgent", "priority high", "high priority")):
            return "urgent"
        if "low priority" in msg_l or "minor" in msg_l:
            return "low"
        if "medium" in msg_l:
            return "medium"
        return "high" if "not working" in msg_l or "broken" in msg_l else "medium"

    @staticmethod
    def _extract_location_from_text(raw: str) -> str:
        text = raw.strip()
        patterns = [
            r"\b(?:in|at)\s+([A-Za-z0-9\-\s]+?)(?:,|\.|;| and | with | is | not | please | urgent |$)",
            r"\b(?:tower|building|block|floor|room|zone)\s+([A-Za-z0-9\-\s]+?)(?:,|\.|;| and | with | is | not | please | urgent |$)",
        ]
        for p in patterns:
            m = re.search(p, text, flags=re.IGNORECASE)
            if m:
                loc = m.group(1).strip(" -")
                if loc:
                    return loc
        return "Unknown"

    @staticmethod
    def _extract_requester_from_text(raw: str) -> tuple[str, str]:
        text = raw.strip()
        m = re.search(r"\b(?:i am|this is|my name is)\s+([A-Za-z][A-Za-z\s]{1,40})", text, flags=re.IGNORECASE)
        if m:
            name = " ".join(m.group(1).split())[:50]
            local = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".")
            if local:
                return name, f"{local}@plenum-tech.com"
        return "System", "system@plenum-tech.com"

    @staticmethod
    def _extract_asset_from_text(raw: str) -> str:
        text = raw.strip()
        # Prefer explicit equipment-style codes first (AHU-12, PUMP-7, CHLR-01)
        m = re.search(r"\b([A-Z]{2,6}-\d{1,6})\b", text)
        if m:
            return m.group(1)
        # Next, look for known equipment nouns.
        nouns = ("ahu", "hvac", "chiller", "pump", "generator", "elevator", "boiler", "motor", "fan", "valve")
        low = text.lower()
        for n in nouns:
            if n in low:
                return n.upper()
        return "Unknown Asset"

    async def _prepare_from_implicit_work_request(
        self,
        *,
        session_id: str,
        original_request: str,
    ) -> dict[str, Any]:
        msg_l = " ".join((original_request or "").strip().lower().split())
        asset = self._extract_asset_from_text(original_request)
        location = self._extract_location_from_text(original_request)
        priority = self._extract_priority_from_text(msg_l)
        requester_name, requester_email = self._extract_requester_from_text(original_request)
        out = await prepare_intelligent_work_order.ainvoke(
            {
                "source": "chat",
                "asset": asset,
                "location": location,
                "issue_description": original_request,
                "priority": priority,
                "request_type": "repair",
                "requester_name": requester_name,
                "requester_email": requester_email,
                "session_id": session_id,
            }
        )
        answer = out.get("reply") if isinstance(out, dict) else None
        if not isinstance(answer, str) or not answer.strip():
            answer = "I prepared the work-order assessment. Please review and confirm to continue."
        return {
            "session_id": session_id,
            "answer": answer,
            "tool_calls": [
                {
                    "tool": "prepare_intelligent_work_order",
                    "input": {
                        "source": "chat",
                        "asset": asset,
                        "location": location,
                        "issue_description": original_request,
                        "priority": priority,
                        "request_type": "repair",
                        "requester_name": requester_name,
                        "requester_email": requester_email,
                        "session_id": session_id,
                    },
                    "output": json.dumps(out, default=str),
                }
            ],
            "success": True,
            "error": None,
            "interrupted": False,
            "interrupt_payload": None,
        }

    async def _stream_shortcut_events(
        self, shortcut: dict[str, Any], session_id: str
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Emit WebSocket events for a deterministic short-reply tool path."""
        for tc in shortcut.get("tool_calls") or []:
            tool_name = tc.get("tool", "")
            domain = _TOOL_DOMAIN.get(tool_name, "wo_engine")
            tool_input = tc.get("input") or {}
            yield {
                "type": "tool_started",
                "tool": tool_name,
                "domain": domain,
                "input": tool_input,
            }
            yield {
                "type": "tool_completed",
                "tool": tool_name,
                "domain": domain,
                "output": tc.get("output"),
            }
        log.info("orchestrator.stream.shortcut", session_id=session_id)
        yield workflow_stream_completion_payload(
            session_id,
            answer=str(shortcut.get("answer") or ""),
            tool_calls=list(shortcut.get("tool_calls") or []),
        )

    async def _invoke(
        self,
        input_: Any,
        thread_id: str,
        session_id: str,
    ) -> dict[str, Any]:
        """Invoke the agent and normalise the result into our response shape."""
        config = self._config(thread_id)
        set_session_context(thread_id)
        try:
            result = await self._agent.ainvoke(input_, config)
        except Exception as exc:
            err = friendly_openai_error(exc)
            log.error("orchestrator.invoke.error", thread_id=thread_id, error=err, exc_info=True)
            return {
                "session_id": session_id,
                "answer": "",
                "tool_calls": [],
                "success": False,
                "error": err,
                "interrupted": False,
                "interrupt_payload": None,
            }

        messages = result.get("messages", [])
        interrupt_payload = _extract_interrupt(result)

        log.info(
            "orchestrator.invoke.done",
            session_id=session_id,
            interrupted=interrupt_payload is not None,
            tool_call_count=len(_extract_tool_calls(messages)),
        )

        tool_calls = _extract_tool_calls(messages)
        out = {
            "session_id": session_id,
            "answer": _extract_answer(messages),
            "tool_calls": tool_calls,
            "success": True,
            "error": None,
            "interrupted": interrupt_payload is not None,
            "interrupt_payload": interrupt_payload,
        }
        domain = "meta"
        tool_name = ""
        if tool_calls:
            tool_name = str(tool_calls[-1].get("tool") or "")
            domain = _TOOL_DOMAIN.get(tool_name, "meta")
        return attach_route_to_result(
            out,
            session_id,
            domain=domain,
            tool=tool_name,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(
        self,
        user_message: str,
        session_id: str | None = None,
        extra_context: str | None = None,
    ) -> dict[str, Any]:
        """
        Run the orchestrator on a single user request (stateless).

        Each call gets a unique thread_id so state never bleeds between
        unrelated requests, even when a checkpointer is configured.

        Returns a dict with keys:
            session_id, answer, tool_calls, success, error,
            interrupted, interrupt_payload
        """
        sid = session_id or str(uuid.uuid4())
        thread_id = str(uuid.uuid4())   # fresh thread — stateless
        system_prompt = build_system_prompt(extra_context)
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message),
        ]
        log.info("orchestrator.run.start", session_id=sid, message_len=len(user_message))
        return await self._invoke({"messages": messages}, thread_id, sid)

    async def run_stateful(
        self,
        user_message: str,
        session_id: str,
        extra_context: str | None = None,
    ) -> dict[str, Any]:
        """
        Run the orchestrator with a persistent thread (HITL-capable).

        Uses session_id as the LangGraph thread_id so the graph state
        is saved to the Postgres checkpointer after each step.  If a
        tool calls interrupt(), this returns with interrupted=True and
        the interrupt_payload for human review.

        Call resume() with the same session_id to continue.
        """
        set_session_context(session_id)
        record_conversation_turn(session_id, "user", user_message)
        session_state = get_session_state(session_id)
        msg_l = " ".join((user_message or "").strip().lower().split())
        route_intent = resolve_route_intent(msg_l, session_state, extra_context)
        wo_clarification_confirmed = False
        asks_udr_run = route_intent == ROUTE_UDR_MAP or (
            route_intent == ROUTE_UDR_INGEST and "run" in msg_l
        )
        if asks_udr_run and not workspace_has_ingestion(session_state):
            return attach_route_to_result(
                {
                    "session_id": session_id,
                    "answer": (
                        "No data is ingested yet for this workspace. Upload CSV/Excel/PDF/Word/image "
                        "files, or connect Fiix (collect subdomain + API keys, then start_fiix_schema_mapping "
                        "or start_fiix_ingestion), then I can run UDR mapping and hierarchy."
                    ),
                    "tool_calls": [],
                    "success": True,
                    "error": None,
                    "interrupted": False,
                    "interrupt_payload": None,
                },
                session_id,
                intent=ROUTE_UDR_INGEST,
                domain="udr",
                next_step_prompt="Upload files or complete Fiix schema mapping / sync, then ask to run mapping and hierarchy.",
            )

        if asks_udr_run and workspace_has_ingestion(session_state):
            unstructured_only = session_state.get("ingestion_mode") == "unstructured"
            if (
                not unstructured_only
                and session_state.get("mapping_status") != "complete"
            ):
                return attach_route_to_result(
                    {
                        "session_id": session_id,
                        "answer": (
                            "Files are ingested. Next, run schema mapping on your structured data "
                            "(migration flow), then hierarchy review. Say: run mapping and hierarchy "
                            "or upload CSV/Excel if you have not migrated yet."
                        ),
                        "tool_calls": [],
                        "success": True,
                        "error": None,
                        "interrupted": False,
                        "interrupt_payload": None,
                    },
                    session_id,
                    intent=ROUTE_UDR_MAP,
                    domain="migration",
                    next_step_prompt="Complete field mapping and hierarchy gates via migration tools.",
                )
        if bool(session_state.get("pending_wo_clarification")):
            if self._is_affirmative_message(msg_l):
                original = str(session_state.get("pending_wo_text") or user_message).strip()
                session_state["pending_wo_clarification"] = False
                session_state["pending_wo_text"] = ""
                return await self._prepare_from_implicit_work_request(
                    session_id=session_id,
                    original_request=original,
                )
            elif self._is_negative_message(msg_l):
                session_state["pending_wo_clarification"] = False
                session_state["pending_wo_text"] = ""
                return attach_route_to_result(
                    {
                        "session_id": session_id,
                        "answer": (
                            "Understood. I will not create a work order from that request. "
                            "Tell me what you want to do next."
                        ),
                        "tool_calls": [],
                        "success": True,
                        "error": None,
                        "interrupted": False,
                        "interrupt_payload": None,
                    },
                    session_id,
                    intent=ROUTE_GENERAL,
                    domain="meta",
                )

        wo_band = work_request_confidence_band(msg_l)
        if (not wo_clarification_confirmed) and wo_band in ("high", "medium"):
            session_state["pending_wo_clarification"] = True
            session_state["pending_wo_text"] = user_message
            prompt = (
                "This looks like a work request (high confidence). "
                "Should I plan and create a work order?"
                if wo_band == "high"
                else "This may be a work request. Should I create and plan a work order from your message?"
            )
            return attach_route_to_result(
                {
                    "session_id": session_id,
                    "answer": prompt,
                    "tool_calls": [],
                    "success": True,
                    "error": None,
                    "interrupted": False,
                    "interrupt_payload": None,
                },
                session_id,
                intent=ROUTE_WO_CLARIFY,
                domain="wo_engine",
                next_step_prompt="Reply yes to proceed with prepare_intelligent_work_order, or no to cancel.",
            )
        if (not wo_clarification_confirmed) and wo_band == "low" and self._looks_like_work_request_without_wo_keyword(msg_l):
            return attach_route_to_result(
                {
                    "session_id": session_id,
                    "answer": (
                        "I am not sure if this is a work request, a document question, or a data query. "
                        "Please clarify: create a work order, search documents, or query the register?"
                    ),
                    "tool_calls": [],
                    "success": True,
                    "error": None,
                    "interrupted": False,
                    "interrupt_payload": None,
                },
                session_id,
                intent=ROUTE_GENERAL,
                domain="meta",
            )

        shortcut = await self._stateful_preflight_shortcut(
            user_message, session_id, session_state, route_intent, msg_l
        )
        if shortcut is not None:
            log.info("orchestrator.run_stateful.shortcut", session_id=session_id)
            if not shortcut.get("route_metadata"):
                return attach_route_to_result(shortcut, session_id)
            return shortcut

        input_ = await self._build_stateful_input(session_id, user_message, extra_context)
        log.info("orchestrator.run_stateful.start", session_id=session_id)
        return await self._invoke(input_, session_id, session_id)

    @staticmethod
    def _looks_like_work_request_without_wo_keyword(msg_l: str) -> bool:
        if "work order" in msg_l or "wo-" in msg_l:
            return False
        issue_terms = (
            "leak",
            "broken",
            "not working",
            "malfunction",
            "repair",
            "urgent",
            "hvac",
            "chiller",
            "pump",
            "generator",
            "elevator",
            "inspection finding",
            "alarm",
            "fault",
            "failure",
            "trip",
            "down",
            "overheat",
            "smell",
            "water",
            "temperature",
            "pressure",
        )
        intent_verbs = (
            "fix",
            "repair",
            "replace",
            "check",
            "inspect",
            "service",
            "resolve",
            "attend",
        )
        infra_terms = (
            "ahu",
            "hvac",
            "chiller",
            "pump",
            "generator",
            "elevator",
            "ac",
            "air handling",
            "boiler",
            "motor",
            "fan",
            "valve",
        )
        has_issue = any(t in msg_l for t in issue_terms)
        has_intent = any(v in msg_l for v in intent_verbs)
        has_asset_hint = any(a in msg_l for a in infra_terms)
        return has_issue or (has_intent and has_asset_hint)

    async def resume(
        self,
        session_id: str,
        decision: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Resume an interrupted stateful workflow with a human decision.

        Args:
            session_id: The session_id used in the original run_stateful() call.
            decision:   The human's answer to the interrupt payload.
                        For mapping_approval:   {"approved": bool, "corrections": dict}
                        For rollback_confirmation: {"confirmed": bool}

        Returns the same response shape as run_stateful().
        """
        if not self._has_hitl:
            return {
                "session_id": session_id,
                "answer": "",
                "tool_calls": [],
                "success": False,
                "error": "HITL is not enabled — no checkpointer configured",
                "interrupted": False,
                "interrupt_payload": None,
            }

        log.info("orchestrator.resume", session_id=session_id, decision_keys=list(decision.keys()))
        return await self._invoke(Command(resume=decision), session_id, session_id)

    async def stream(
        self,
        user_message: str,
        session_id: str | None = None,
        extra_context: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Stream workflow events as typed dicts for WebSocket delivery.

        Yields event dicts with `type` in:
          tool_started       — a tool call is beginning
          tool_completed     — a tool call finished
          agent_switch       — the active domain changed between consecutive tools
          gate_interrupt     — a HITL interrupt() fired (map_fields or rollback)
          workflow_completed — the agent returned its final answer
          error              — an unexpected exception occurred

        Uses session_id as LangGraph thread_id (same as run_stateful) so checkpoint
        history accumulates. Session conversation_turns backstop when HITL is off.
        """
        sid = session_id or str(uuid.uuid4())
        thread_id = sid
        config = self._config(thread_id)
        set_session_context(sid)
        record_conversation_turn(sid, "user", user_message)

        session_state = get_session_state(sid)
        msg_l = " ".join((user_message or "").strip().lower().split())
        route_intent = resolve_route_intent(msg_l, session_state, extra_context)

        shortcut = await self._stateful_preflight_shortcut(
            user_message, sid, session_state, route_intent, msg_l
        )
        if shortcut is not None:
            if not shortcut.get("route_metadata"):
                shortcut = attach_route_to_result(shortcut, sid)
            async for ev in self._stream_shortcut_events(shortcut, sid):
                yield ev
            return

        input_ = await self._build_stateful_input(sid, user_message, extra_context)

        last_domain: str | None = None
        final_answer = ""
        streamed_tool_calls: list[dict[str, Any]] = []
        log.info("orchestrator.stream.start", session_id=sid, message_len=len(user_message))

        try:
            async for event in self._agent.astream_events(input_, config, version="v2"):
                kind = event["event"]

                if kind == "on_tool_start":
                    tool_name = event.get("name", "")
                    domain = _TOOL_DOMAIN.get(tool_name, "unknown")
                    tool_input = event.get("data", {}).get("input", {})

                    if last_domain is not None and domain != last_domain:
                        yield {
                            "type": "agent_switch",
                            "from_domain": last_domain,
                            "to_domain": domain,
                        }
                    last_domain = domain

                    yield {
                        "type": "tool_started",
                        "tool": tool_name,
                        "domain": domain,
                        "input": tool_input,
                    }

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    domain = _TOOL_DOMAIN.get(tool_name, "unknown")
                    raw_out = event.get("data", {}).get("output")
                    output = getattr(raw_out, "content", raw_out)
                    if domain == "wo_engine":
                        from .wo_engine_agent import capture_work_order_from_tool_output

                        capture_work_order_from_tool_output(sid, output)

                    streamed_tool_calls.append(
                        {
                            "tool": tool_name,
                            "input": event.get("data", {}).get("input", {}),
                            "output": output,
                        }
                    )
                    yield {
                        "type": "tool_completed",
                        "tool": tool_name,
                        "domain": domain,
                        "output": output,
                    }

                elif kind == "on_chat_model_end":
                    output_msg = event.get("data", {}).get("output")
                    if output_msg and not getattr(output_msg, "tool_calls", None):
                        content = getattr(output_msg, "content", "")
                        if isinstance(content, str) and content:
                            final_answer = content

        except GraphInterrupt as gi:
            payload = gi.args[0] if gi.args else {}
            log.info("orchestrator.stream.gate_interrupt", session_id=sid)
            yield {"type": "gate_interrupt", "payload": payload, "session_id": sid}
            return

        except Exception as exc:
            err = friendly_openai_error(exc)
            log.error("orchestrator.stream.error", session_id=sid, error=err, exc_info=True)
            yield {"type": "error", "error": err, "session_id": sid}
            return

        log.info("orchestrator.stream.done", session_id=sid)
        if final_answer.strip():
            record_conversation_turn(sid, "assistant", final_answer)
        yield workflow_stream_completion_payload(
            sid,
            answer=final_answer,
            tool_calls=streamed_tool_calls,
        )

    async def get_thread_state(self, session_id: str) -> dict[str, Any] | None:
        """
        Return the saved LangGraph state for a thread, or None if not found.
        Used by the /status endpoint to check whether a session is interrupted.
        """
        if not self._has_hitl:
            return None
        config = self._config(session_id)
        try:
            snapshot = await self._agent.aget_state(config)
            if snapshot is None:
                return None
            interrupts = snapshot.tasks  # pending interrupt tasks
            return {
                "session_id": session_id,
                "interrupted": bool(interrupts),
                "interrupt_payload": interrupts[0].interrupts[0].value if interrupts else None,
            }
        except Exception as exc:
            log.warning("orchestrator.get_thread_state.error", session_id=session_id, error=str(exc))
            return None
